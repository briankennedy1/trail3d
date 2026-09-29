#!/usr/bin/env python3
"""Import literal public planner datasets without executing the source JavaScript."""
import hashlib, json, pathlib, re, sys, urllib.request, datetime
BASE='https://everstokeplanner.netlify.app/'
ROOT=pathlib.Path(__file__).resolve().parents[1]
class Literals:
 def __init__(self,s): self.s=s; self.i=0
 def whitespace(self):
  while self.i<len(self.s) and self.s[self.i].isspace(): self.i+=1
 def value(self):
  self.whitespace(); c=self.s[self.i]
  if c=='`':
   end=self.s.index('`',self.i+1); v=self.s[self.i+1:end]; assert '${' not in v; self.i=end+1; return v
  if c=='"':
   v,n=json.JSONDecoder().raw_decode(self.s[self.i:]); self.i+=n; return v
  if c in '[{':
   self.i+=1; result=[] if c=='[' else {}; end=']' if c=='[' else '}'
   self.whitespace()
   while self.s[self.i]!=end:
    if c=='{':
     self.whitespace()
     if self.s[self.i]=='"': key=self.value()
     else:
      m=re.match(r'[A-Za-z_$][\w$]*',self.s[self.i:]); assert m; key=m[0]; self.i+=len(key)
     self.whitespace(); assert self.s[self.i]==':'; self.i+=1; result[key]=self.value()
    else: result.append(self.value())
    self.whitespace()
    if self.s[self.i]!=',': break
    self.i+=1
   assert self.s[self.i]==end; self.i+=1; return result
  for token,val in [('null',None),('true',True),('false',False),('!0',True),('!1',False)]:
   if self.s.startswith(token,self.i): self.i+=len(token); return val
  m=re.match(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?',self.s[self.i:]); assert m, self.s[self.i:self.i+30]
  self.i+=len(m[0]); return json.loads(m[0])
def read(url):
 with urllib.request.urlopen(url, timeout=30) as r: return r.read().decode()
def main():
 if len(sys.argv)>1: bundle=pathlib.Path(sys.argv[1]).read_text(); asset=BASE+'assets/index-BmeEHyE4.js'
 else:
  html=read(BASE); asset=BASE+re.search(r'src="(/assets/[^\"]+\.js)"',html)[1].lstrip('/'); bundle=read(asset)
 records={}
 for match in re.finditer(r'=\[\{id:',bundle):
  value=Literals(bundle[match.start()+1:]).value()
  if value and 'climbingFt' in value[0]: records['rides']=value
  elif value and 'summary' in value[0] and 'type' in value[0]: records['adventures']=value
 assert set(records)=={'rides','adventures'}
 towns_match=re.search(r'=\[\{name:"Graeagle",lat:',bundle)
 towns=Literals(bundle[towns_match.start()+1:]).value() if towns_match else []
 defaults_match=re.search(r'=\{"Lakes Basin":10,Portola:',bundle)
 defaults=Literals(bundle[defaults_match.start()+1:]).value() if defaults_match else {}
 home_match=re.search(r'=\{lat:39\.78074596510399,lng:',bundle)
 home=Literals(bundle[home_match.start()+1:]).value() if home_match else None
 settings={'towns':towns,'defaultDriveMinutes':defaults,'everstoke':home}
 assert len(towns)==8 and defaults and home, 'Planner settings changed; inspect the public source before importing.'
 (ROOT/'data'/'planner-settings.json').write_text(json.dumps(settings,indent=2)+'\n')
 for kind,items in records.items():
  assert len({i['id'] for i in items})==len(items)
  (ROOT/'data'/f'planner-{kind}.json').write_text(json.dumps(items,indent=2,ensure_ascii=False)+'\n')
 meta={'source':BASE,'asset':asset,'importedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha256':hashlib.sha256(bundle.encode()).hexdigest(),'counts':{k:len(v) for k,v in records.items()},'scope':'Publicly shipped planner data; unsaved admin edits are not included.'}
 (ROOT/'data'/'planner-source.json').write_text(json.dumps(meta,indent=2)+'\n')
 print(json.dumps(meta,indent=2))
 for r in records['rides']: print(r['id'],r['coordinates'],r.get('routeUrl'))
if __name__=='__main__': main()
