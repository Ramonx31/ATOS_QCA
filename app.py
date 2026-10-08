"""QCA Atos: servidor exclusivo de loopback, sem envio externo de dados."""
import base64, csv, io, json, os, re, secrets, sys, threading, unicodedata, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))
TOKEN = secrets.token_urlsafe(32)

def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s)).lower() if unicodedata.category(c) != 'Mn').strip()

def number(s):
    s = str(s).strip()
    if not s: return None
    if not re.fullmatch(r'\d+(?:\.\d{3})*', s): return None
    return int(s.replace('.', ''))

# Atos sem automação registrada que a equipe decidiu excluir da leitura, para que o painel
# mostre somente os atos relevantes para a análise de automação. Comparação feita após
# normalizar acento, caixa e espaços (ver norm()), para não depender da grafia exata do print
# ou da planilha de origem.
EXCLUDED_ATOS = {norm(a) for a in [
    "PA de Recurso da Parte Contrária",
    "PA'S Preenchidas - Outras",
    "Encaminhados para Negociação",
    "Obrigações Comprovadas",
    "Garantias Cadastradas",
    "PA de Procedência",
    "Audiências Realizadas",
    "Encerramentos",
    "Obrigações Notificadas",
]}

def _dehyphen(s):
    # Remove espaços em volta de hífen antes de comparar. Diferente de tolerar ruído de
    # leitura de caracteres (que pode confundir atos distintos), a presença ou ausência de
    # espaço ao redor de um hífen é só formatação e não muda o nome do ato nem pode causar
    # ambiguidade com outro ato da lista.
    return re.sub(r'\s*-\s*', '-', s)

_EXCLUDED_CLEAN = {_dehyphen(k.replace("'", "").replace("’", "")) for k in EXCLUDED_ATOS}

def is_excluded_ato(name):
    # Comparação exata após normalizar acento, caixa, espaços, apóstrofo (reto ou curvo) e
    # espaçamento ao redor de hífen. Deliberadamente não usa correspondência aproximada
    # (similaridade ou distância de edição) para o restante do texto: nomes de ato parecidos
    # podem ter sentido oposto (ex.: "Procedência" x "Improcedência"), então tolerar ruído de
    # OCR de forma genérica arrisca excluir por engano um ato que deveria aparecer no painel.
    # Quando o OCR distorce a grafia de um ato da lista de exclusão a ponto de não bater
    # exatamente, a linha continua aparecendo na tela de revisão (com nome visivelmente
    # estranho) para o usuário corrigir ou excluir manualmente antes de salvar.
    cleaned = _dehyphen(norm(name).replace("'", "").replace("’", ""))
    return cleaned in _EXCLUDED_CLEAN

OCR_ENGINE = None
OCR_LOCK = threading.Lock()

def engine():
    try:
        import rapidocr_onnxruntime
        return True
    except ImportError:
        return False

def parse_ocr(result):
    words=[]
    for box, text, confidence in result or []:
        if not str(text).strip(): continue
        xs=[v[0] for v in box]; ys=[v[1] for v in box]
        words.append(dict(text=str(text).strip(),x=min(xs),y=min(ys),w=max(xs)-min(xs),h=max(ys)-min(ys)))
    headers=sorted([w for w in words if norm(w['text']).replace(' ','') in ('atosmanuais','manuais')],key=lambda w:(w['y'],w['x']))
    if not headers: raise ValueError('Cabeçalho Atos Manuais não localizado. Envie a tabela completa, nítida e com os cabeçalhos.')
    manual=headers[0]; cy=manual['y']+manual['h']/2
    line=sorted([w for w in words if abs(w['y']+w['h']/2-cy)<manual['h']*.55],key=lambda w:w['x'])
    auto=next((w for w in line if norm(w['text']).replace(' ','') in ('atosautomatizados','automatizados') and w['x']>manual['x']),None)
    total=next((w for w in line if norm(w['text'])=='total' and auto and w['x']>auto['x']),None)
    ato=next((w for w in line if norm(w['text'])=='ato'),None)
    if not all([auto,total,ato]): raise ValueError('Não foi possível identificar as quatro colunas: Ato, Atos Manuais, Atos Automatizados e Total.')
    centers=[w['x']+w['w']/2 for w in (manual,auto,total)]
    bounds=[manual['x']-manual['h']*.4,(centers[0]+centers[1])/2,(centers[1]+centers[2])/2,centers[2]+(centers[2]-centers[1])/2]
    left=max(0,2*(ato['x']+ato['w']/2)-bounds[0]-manual['h']*.5)
    candidates=[w for w in words if w['y']+w['h']/2>cy+manual['h']*.75 and left<=w['x']<bounds[3]]
    groups=[]
    for w in sorted(candidates,key=lambda w:w['y']+w['h']/2):
        wc=w['y']+w['h']/2
        if groups and abs(groups[-1]['cy']-wc)<manual['h']*.35: groups[-1]['words'].append(w)
        else: groups.append({'cy':wc,'words':[w]})
    rows=[];excluded=[];expected=None
    for g in groups:
        cols=[[] for _ in range(4)]
        for w in sorted(g['words'],key=lambda w:w['x']):
            mid=w['x']+w['w']/2
            idx=0 if mid<bounds[0] else 1 if mid<bounds[1] else 2 if mid<bounds[2] else 3
            cols[idx].append(w['text'])
        name=' '.join(cols[0]).strip(' |')
        # Célula sem nenhuma palavra detectada pelo OCR: a tabela de origem deixa em branco
        # no lugar de "0", então é seguro preencher com 0. Quando há palavra(s) na célula mas
        # elas não formam um número válido (ruído/erro de leitura), o campo fica None para
        # revisão manual, evitando mascarar uma falha de OCR como um valor real.
        nums=[0 if not v else number(''.join(v).strip('|')) for v in cols[1:]]
        if norm(name)=='total':
            expected=dict(manual=nums[0],auto=nums[1],total=nums[2]);break
        if name and is_excluded_ato(name):
            excluded.append(dict(ato=name,manual=nums[0],auto=nums[1],total=nums[2]));continue
        if name and any(x is not None for x in nums):rows.append(dict(ato=name,manual=nums[0],auto=nums[1],total=nums[2]))
    if not rows:raise ValueError('Nenhuma linha reconhecida. Tente uma imagem mais nítida.')
    # Os totais do BI informados no print incluem os atos excluídos. Para que a reconciliação
    # (Manual + Automatizado = Total) continue válida com a tabela filtrada, subtrai-se dos
    # totais esperados a soma dos atos excluídos que foram lidos com números válidos.
    if expected and excluded:
        for k in ('manual','auto','total'):
            if expected[k] is not None and all(e[k] is not None for e in excluded):
                expected[k]=expected[k]-sum(e[k] for e in excluded)
    note='Leitura local concluída. Confira nomes e valores com o print. Células sem nenhum número detectado foram preenchidas com 0; campos com texto não numérico ficam pendentes para revisão.'
    if excluded: note+=f' {len(excluded)} ato(s) sem automação relevante foram descartados da leitura; os totais do BI foram ajustados para refletir apenas os atos exibidos.'
    note+=' Se algum ato sem automação ainda aparecer na tabela com nome malformado pelo leitor, remova a linha manualmente antes de confirmar.'
    return dict(rows=rows,expected=expected,note=note)

def extract_image(raw):
    global OCR_ENGINE
    try:
        from rapidocr_onnxruntime import RapidOCR
        import numpy as np
    except ImportError:
        raise ValueError('O leitor de prints ainda não foi instalado. Feche a plataforma, execute INSTALAR.bat e abra INICIAR.bat novamente. Não é necessário instalar Tesseract.')
    with Image.open(io.BytesIO(raw)) as source:
        if source.width*source.height>20_000_000:raise ValueError('Use um print de até 20 megapixels.')
        im=ImageOps.exif_transpose(source).convert('RGB')
        # 2200px no maior lado preserva a nitidez necessária para ler números de tabela e
        # reduz bastante o tempo de processamento em relação ao limite anterior de 3000px.
        if max(im.size)>2200:
            im.thumbnail((2200,2200))
        pixels=np.asarray(im)[:,:,::-1].copy()
    with OCR_LOCK:
        if OCR_ENGINE is None:
            # inter_op_num_threads=1 evita overhead de sincronização entre operadores
            # independentes (o grafo deste modelo tem poucos para paralelizar nesse nível).
            # intra_op_num_threads=4 dá paralelismo moderado dentro de cada operação sem
            # saturar a CPU, o que se mostrou mais rápido e estável do que threads simétricos
            # (2/2) ou automáticos (-1/-1) nos testes realizados.
            # det_limit_side_len=2048: valores menores (ex.: 1024) aceleram a detecção, mas
            # geram recortes de texto menores que o reconhecedor amplia com mais perda de
            # nitidez, piorando a leitura de nomes de ato (ex.: "Obrigações" lido como
            # "Obrigages"). Isso causava inconsistência entre o print e o painel: um ato que
            # deveria ser excluído da análise (ver EXCLUDED_ATOS) não era reconhecido com a
            # grafia exata e acabava aparecendo no painel. A fidelidade da leitura em relação
            # ao print tem prioridade sobre o tempo de leitura.
            OCR_ENGINE=RapidOCR(intra_op_num_threads=4,inter_op_num_threads=1,det_limit_side_len=2048)
        # use_cls=False desativa a classificação de ângulo do texto: prints de tela sempre vêm
        # na orientação correta, então essa etapa só consome tempo sem necessidade.
        result,_=OCR_ENGINE(pixels,use_cls=False)
    return parse_ocr(result)

def extract_sheet(raw, name):
    if name.lower().endswith('.csv'):
        try: txt=raw.decode('utf-8-sig')
        except UnicodeDecodeError: txt=raw.decode('cp1252')
        try: dialect=csv.Sniffer().sniff(txt[:4096],delimiters=';,\t')
        except csv.Error: dialect=csv.excel
        data=list(csv.reader(io.StringIO(txt),dialect))
    else:
        from openpyxl import load_workbook
        wb=load_workbook(io.BytesIO(raw),read_only=True,data_only=True)
        data=list(wb.active.values); wb.close()
    if not data: raise ValueError('Planilha vazia.')
    headers=[norm(x) for x in data[0]]
    aliases=[['ato'],['atos manuais','manual','manuais'],['atos automatizados','automatizados','auto'],['total']]
    ix=[next((headers.index(a) for a in names if a in headers),None) for names in aliases]
    if any(i is None for i in ix[:3]): raise ValueError('Use os cabeçalhos: Ato; Atos Manuais; Atos Automatizados; Total (opcional). No Excel, é lida a primeira aba.')
    rows=[]; excluded=[]; expected=None
    for r in data[1:]:
        if not r or ix[0]>=len(r) or not r[ix[0]]: continue
        vals=[];empties=[]
        for i in ix[1:]:
            v=r[i] if i is not None and i<len(r) else None
            empty=v is None or (isinstance(v,str) and not v.strip())
            empties.append(empty)
            vals.append(None if empty else int(v) if isinstance(v,(int,float)) and v>=0 and v==int(v) else number(v))
        # Manual e Automatizado vazios (sem ambiguidade de OCR) já são 0 antes do cálculo do
        # Total, para que uma linha com as duas colunas em branco e o Total informado não
        # fique presa esperando valores que a fonte nunca teve.
        for j in (0,1):
            if empties[j] and vals[j] is None: vals[j]=0
        if vals[2] is None and all(x is not None for x in vals[:2]): vals[2]=vals[0]+vals[1]
        if empties[2] and vals[2] is None: vals[2]=0
        row=dict(ato=str(r[ix[0]]),manual=vals[0],auto=vals[1],total=vals[2])
        if norm(row['ato'])=='total': expected={k:row[k] for k in ['manual','auto','total']}
        elif is_excluded_ato(row['ato']): excluded.append(row)
        else: rows.append(row)
    # Os totais do BI informados na planilha (linha Total) incluem os atos excluídos. Para que
    # a reconciliação continue válida com a tabela filtrada, subtrai-se dos totais esperados a
    # soma dos atos excluídos lidos com números válidos.
    if expected and excluded:
        for k in ('manual','auto','total'):
            if expected[k] is not None and all(e[k] is not None for e in excluded):
                expected[k]=expected[k]-sum(e[k] for e in excluded)
    note='Confira a tabela antes de salvar. Células vazias foram preenchidas com 0. Uma importação representa uma equipe e um mês.'
    if excluded: note+=f' {len(excluded)} ato(s) sem automação relevante foram descartados da leitura; os totais foram ajustados para refletir apenas os atos exibidos.'
    return dict(rows=rows,expected=expected,note=note)

class Handler(BaseHTTPRequestHandler):
    def send(self,body,status=200,kind='application/json; charset=utf-8'):
        if not isinstance(body,bytes): body=json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type',kind); self.send_header('Content-Length',str(len(body)))
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
    def valid_host(self): return self.headers.get('Host')==f'127.0.0.1:{self.server.server_port}'
    def do_GET(self):
        if not self.valid_host(): return self.send({'error':'Host inválido'},403)
        if self.path=='/': return self.send((ROOT/'static/index.html').read_text(encoding='utf-8').replace('__TOKEN__',TOKEN).encode(),kind='text/html; charset=utf-8')
        if self.path=='/app.js': return self.send((ROOT/'static/app.js').read_text(encoding='utf-8').replace('__TOKEN__',TOKEN).encode(),kind='text/javascript; charset=utf-8')
        if self.path=='/sample': return self.send((ROOT/'exemplo/dados.json').read_bytes())
        if self.path=='/sample.png': return self.send((ROOT/'exemplo/print.png').read_bytes(),kind='image/png')
        if self.path=='/organization': return self.send((ROOT/'data/organization.json').read_bytes())
        if self.path=='/health': return self.send({'ocr':bool(engine()),'engine':'RapidOCR'})
        self.send({'error':'Não encontrado'},404)
    def do_POST(self):
        if not self.valid_host() or self.headers.get('X-App-Token')!=TOKEN: return self.send({'error':'Acesso inválido'},403)
        if self.path!='/import': return self.send({'error':'Não encontrado'},404)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<16_000_000: raise ValueError('Arquivo acima do limite de 10 MB.')
            payload=json.loads(self.rfile.read(length)); raw=base64.b64decode(payload['data'],validate=True)
            if len(raw)>10_000_000: raise ValueError('Arquivo acima do limite de 10 MB.')
            name=payload['name'].lower()
            result=extract_sheet(raw,name) if name.endswith(('.xlsx','.csv')) else extract_image(raw)
            self.send(result)
        except Exception as e: self.send({'error':str(e)},400)
    def log_message(self,*args): pass

if __name__=='__main__':
    try: server=ThreadingHTTPServer(('127.0.0.1',8765),Handler)
    except OSError:
        print('A porta 8765 está ocupada. Feche outra instância do QCA Atos e tente novamente.'); input('Enter para sair...'); sys.exit(1)
    print('QCA Atos em http://127.0.0.1:8765 — feche esta janela para encerrar.')
    if '--no-browser' not in sys.argv: threading.Timer(.6,lambda:webbrowser.open('http://127.0.0.1:8765')).start()
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
