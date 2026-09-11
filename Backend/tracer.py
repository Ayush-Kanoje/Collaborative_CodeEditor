#!/usr/bin/env python3
"""Deterministic safe Python-subset tracer: submitted code is never exec'd."""
import ast, json, os, sys
try:
 import resource
except ImportError:
 resource = None
MAX_SOURCE, MAX_EVENTS = 10000, 1000

def apply_cpu_limit():
 try:
  seconds = max(1, int(os.environ.get('TRACE_CPU_SECONDS', '2')))
 except ValueError:
  seconds = 2
 if resource is not None:
  resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds + 1))

class Failure(Exception):
 def __init__(self,k,m,l=None): self.kind,self.message,self.line=k,m,l
class Returned(Exception):
 def __init__(self,v): self.value=v
class Engine:
 def __init__(self,source,limit=MAX_EVENTS):
  if not isinstance(source,str) or not source.strip(): raise Failure('invalid_source','Source must be a non-empty string')
  if len(source)>MAX_SOURCE: raise Failure('source_limit',f'Source exceeds {MAX_SOURCE} characters')
  self.source=source
  try:self.tree=ast.parse(source)
  except SyntaxError as e: raise Failure('syntax_error',e.msg,e.lineno)
  self.limit=max(1,min(int(limit),MAX_EVENTS));self.events=[];self.out=[];self.frames=[{'name':'<module>','locals':{}}];self.funcs={};self.validate()
 def validate(self):
  ok=(ast.Module,ast.FunctionDef,ast.arguments,ast.arg,ast.Return,ast.Assign,ast.AugAssign,ast.Expr,ast.If,ast.For,ast.While,ast.Pass,ast.Name,ast.Constant,ast.List,ast.Dict,ast.Tuple,ast.BinOp,ast.UnaryOp,ast.BoolOp,ast.Compare,ast.Call,ast.Subscript,ast.Load,ast.Store,ast.Add,ast.Sub,ast.Mult,ast.Div,ast.FloorDiv,ast.Mod,ast.Pow,ast.USub,ast.UAdd,ast.Not,ast.And,ast.Or,ast.Eq,ast.NotEq,ast.Lt,ast.LtE,ast.Gt,ast.GtE,ast.In,ast.NotIn,ast.Attribute)
  for n in ast.walk(self.tree):
   if not isinstance(n,ok): raise Failure('unsupported',f'Unsupported construct: {type(n).__name__}',getattr(n,'lineno',None))
   if isinstance(n,ast.Attribute) and n.attr!='append': raise Failure('unsupported',f'Unsupported attribute: {n.attr}',n.lineno)
   if isinstance(n,ast.FunctionDef) and n.decorator_list: raise Failure('unsupported','Function decorators are unsupported',n.lineno)
 def safe(self,x,d=0):
  if d>4:return '<truncated>'
  if x is None or isinstance(x,(bool,int,float,str)):return x
  if isinstance(x,(list,tuple)):return [self.safe(v,d+1) for v in x[:50]]
  if isinstance(x,dict):return {str(k):self.safe(v,d+1) for k,v in list(x.items())[:50]}
  return '<unsupported-value>'
 def snap(self):return {f['name']:self.safe(f['locals']) for f in self.frames}
 def emit(self,line,kind,before,loop=None,branch=None,output=None,error=None):
  if len(self.events)>=self.limit:raise Failure('trace_limit',f'Trace exceeded {self.limit} events',line)
  after=self.snap(); b=before.get(self.frames[-1]['name'],{});a=after.get(self.frames[-1]['name'],{});names=sorted(set(b)|set(a))
  changes=[{'name':n,'before':b.get(n),'after':a.get(n),'kind':'added' if n not in b else 'removed' if n not in a else 'changed'} for n in names if b.get(n)!=a.get(n)]
  self.events.append({'step':len(self.events)+1,'line':line,'eventType':kind,'beforeState':before,'afterState':after,'changedVariables':changes,'output':output,'loopState':loop,'branchState':branch,'callStack':[f['name'] for f in self.frames],'error':error})
 def get(self,n,l):
  for f in reversed(self.frames):
   if n in f['locals']:return f['locals'][n]
  raise Failure('runtime_error',f"NameError: name '{n}' is not defined",l)
 def expr(self,n):
  l=getattr(n,'lineno',None)
  if isinstance(n,ast.Constant):return n.value
  if isinstance(n,ast.Name):return self.get(n.id,l)
  if isinstance(n,ast.List):return [self.expr(x) for x in n.elts]
  if isinstance(n,ast.Tuple):return tuple(self.expr(x) for x in n.elts)
  if isinstance(n,ast.Dict):return {self.expr(k):self.expr(v) for k,v in zip(n.keys,n.values)}
  if isinstance(n,ast.UnaryOp):
   v=self.expr(n.operand);return -v if isinstance(n.op,ast.USub) else +v if isinstance(n.op,ast.UAdd) else not v
  if isinstance(n,ast.BoolOp):return all(self.expr(x) for x in n.values) if isinstance(n.op,ast.And) else any(self.expr(x) for x in n.values)
  if isinstance(n,ast.BinOp):
   a,b=self.expr(n.left),self.expr(n.right);ops={ast.Add:lambda:a+b,ast.Sub:lambda:a-b,ast.Mult:lambda:a*b,ast.Div:lambda:a/b,ast.FloorDiv:lambda:a//b,ast.Mod:lambda:a%b,ast.Pow:lambda:a**b}
   try:return ops[type(n.op)]()
   except ZeroDivisionError:raise Failure('runtime_error','ZeroDivisionError: division by zero',l)
   except (TypeError,KeyError):raise Failure('runtime_error','TypeError: invalid arithmetic operation',l)
  if isinstance(n,ast.Compare):
   a=self.expr(n.left)
   for o,rn in zip(n.ops,n.comparators):
    b=self.expr(rn)
    if isinstance(o,ast.Eq): ok=a==b
    elif isinstance(o,ast.NotEq): ok=a!=b
    elif isinstance(o,ast.Lt): ok=a<b
    elif isinstance(o,ast.LtE): ok=a<=b
    elif isinstance(o,ast.Gt): ok=a>b
    elif isinstance(o,ast.GtE): ok=a>=b
    elif isinstance(o,ast.In): ok=a in b
    else: ok=a not in b
    if not ok:return False
    a=b
   return True
  if isinstance(n,ast.Subscript):return self.expr(n.value)[self.expr(n.slice)]
  if isinstance(n,ast.Call):return self.call(n)
  raise Failure('unsupported',f'Unsupported expression: {type(n).__name__}',l)
 def put(self,t,v,l):
  if isinstance(t,ast.Name):self.frames[-1]['locals'][t.id]=v
  elif isinstance(t,ast.Subscript):self.expr(t.value)[self.expr(t.slice)]=v
  else:raise Failure('unsupported','Unsupported assignment target',l)
 def call(self,n):
  l=n.lineno
  if isinstance(n.func,ast.Name) and n.func.id=='print':self.out.append(' '.join(str(self.expr(a)) for a in n.args));return None
  if isinstance(n.func,ast.Name) and n.func.id=='range':return list(range(*(self.expr(a) for a in n.args)))
  if isinstance(n.func,ast.Attribute) and n.func.attr=='append':self.expr(n.func.value).append(*(self.expr(a) for a in n.args));return None
  if not isinstance(n.func,ast.Name) or n.func.id not in self.funcs:raise Failure('unsupported','Only declared functions, print, and range may be called',l)
  f=self.funcs[n.func.id];args=[self.expr(a) for a in n.args]
  if len(args)!=len(f.args.args):raise Failure('runtime_error',f'TypeError: {f.name} argument count',l)
  before=self.snap();self.frames.append({'name':f.name,'locals':dict(zip([a.arg for a in f.args.args],args))});self.emit(l,'FUNCTION_CALL',before)
  try:self.block(f.body);result=None
  except Returned as r:result=r.value
  before=self.snap();self.frames.pop();self.emit(l,'FUNCTION_RETURN',before);return result
 def block(self,body):
  for n in body:self.stmt(n)
 def stmt(self,n):
  l=n.lineno;b=self.snap()
  if isinstance(n,ast.FunctionDef):self.funcs[n.name]=n
  elif isinstance(n,ast.Assign):
   v=self.expr(n.value)
   for t in n.targets:self.put(t,v,l)
   self.emit(l,'MUTATION' if isinstance(n.targets[0],ast.Subscript) else 'ASSIGNMENT',b)
  elif isinstance(n,ast.AugAssign):
   old=self.expr(n.target); rhs=self.expr(n.value);ops={ast.Add:old+rhs,ast.Sub:old-rhs,ast.Mult:old*rhs};self.put(n.target,ops[type(n.op)],l);self.emit(l,'MUTATION',b)
  elif isinstance(n,ast.Expr):
   p=isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='print';self.expr(n.value);self.emit(l,'OUTPUT' if p else 'MUTATION',b,output=self.out[-1] if p else None)
  elif isinstance(n,ast.If):
   r=bool(self.expr(n.test));self.emit(l,'CONDITION',b,branch={'result':r,'branch':'if' if r else 'else'});self.block(n.body if r else n.orelse)
  elif isinstance(n,ast.For):
   values=self.expr(n.iter);self.emit(l,'LOOP_START',b,loop={'type':'for','iterations':len(values)})
   for i,v in enumerate(values):b=self.snap();self.put(n.target,v,l);self.emit(l,'LOOP_ITERATION',b,loop={'type':'for','iteration':i});self.block(n.body)
  elif isinstance(n,ast.While):
   self.emit(l,'LOOP_START',b,loop={'type':'while'});i=0
   while self.expr(n.test):b=self.snap();self.emit(l,'LOOP_ITERATION',b,loop={'type':'while','iteration':i});self.block(n.body);i+=1
  elif isinstance(n,ast.Return):v=self.expr(n.value) if n.value else None;self.emit(l,'FUNCTION_RETURN',b);raise Returned(v)
  elif not isinstance(n,ast.Pass):raise Failure('unsupported',f'Unsupported statement: {type(n).__name__}',l)
 def run(self):
  b=self.snap();self.emit(1,'PROGRAM_START',b)
  try:self.block(self.tree.body)
  except Failure as e:
   b=self.snap();self.emit(e.line or 1,'EXCEPTION',b,error={'kind':e.kind,'message':e.message});return {'success':False,'status':e.kind,'error':{'message':e.message,'line':e.line},'events':self.events}
  b=self.snap();self.emit(len(self.source.splitlines()) or 1,'PROGRAM_END',b);return {'success':True,'status':'ok','error':None,'events':self.events}
def trace(source,max_events=MAX_EVENTS):
 try:return Engine(source,max_events).run()
 except Failure as e:return {'success':False,'status':e.kind,'error':{'message':e.message,'line':e.line},'events':[]}
if __name__=='__main__':
 try: apply_cpu_limit();r=json.load(sys.stdin);print(json.dumps(trace(r.get('code'),r.get('max_steps',MAX_EVENTS)),separators=(',',':')))
 except Exception as e:print(json.dumps({'success':False,'status':'invalid_request','error':{'message':str(e),'line':None},'events':[]}))
