import unittest
from tracer import trace
class Tests(unittest.TestCase):
 def kinds(self,code,limit=1000):return [x['eventType'] for x in trace(code,limit)['events']]
 def test_assignment(self):self.assertIn('ASSIGNMENT',self.kinds('x=1'))
 def test_mutation(self):self.assertIn('MUTATION',self.kinds('x=1\nx+=2'))
 def test_conditions(self):
  self.assertTrue(trace('if True:\n x=1')['events'][1]['branchState']['result']);self.assertFalse(trace('if False:\n x=1')['events'][1]['branchState']['result'])
 def test_loops(self):self.assertIn('LOOP_ITERATION',self.kinds('for i in range(2):\n x=i'));self.assertIn('LOOP_ITERATION',self.kinds('x=0\nwhile x<2:\n x+=1'))
 def test_function_return(self):
  k=self.kinds('def f(x):\n return x+1\ny=f(2)');self.assertIn('FUNCTION_CALL',k);self.assertIn('FUNCTION_RETURN',k)
 def test_collections_and_output(self):
  k=self.kinds("a=[]\na.append(1)\nd={}\nd['x']=1\nprint(a)");self.assertIn('MUTATION',k);self.assertIn('OUTPUT',k)
 def test_error(self):self.assertEqual(trace('x=1/0')['status'],'runtime_error')
 def test_unsupported(self):self.assertEqual(trace('import os')['status'],'unsupported')
 def test_limit(self):self.assertEqual(trace('for i in range(10):\n x=i',3)['status'],'trace_limit')
if __name__=='__main__':unittest.main()
