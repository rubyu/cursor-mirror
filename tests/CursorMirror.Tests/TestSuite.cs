using System;
using System.Collections.Generic;

namespace CursorMirror.Tests
{
    internal sealed class TestSuite
    {
        private readonly List<TestCase> _tests = new List<TestCase>();

        public void Add(string id, Action body)
        {
            _tests.Add(new TestCase(id, body));
        }

        public int Run()
        {
            int failed = 0;
            foreach (TestCase test in _tests)
            {
                try
                {
                    test.Body();
                    Console.WriteLine("PASS " + test.Id);
                }
                catch (Exception ex)
                {
                    failed++;
                    Console.WriteLine("FAIL " + test.Id);
                    Console.WriteLine(ex.ToString());
                }
            }

            Console.WriteLine("Total: " + _tests.Count + ", Failed: " + failed);
            return failed == 0 ? 0 : 1;
        }

        private sealed class TestCase
        {
            public readonly string Id;
            public readonly Action Body;

            public TestCase(string id, Action body)
            {
                Id = id;
                Body = body;
            }
        }
    }
}
