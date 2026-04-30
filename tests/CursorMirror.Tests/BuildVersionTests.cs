using System.Text.RegularExpressions;

namespace CursorMirror.Tests
{
    internal static class BuildVersionTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MPU-1", InformationalVersionShape);
            suite.Add("COT-MPU-2", NumericAssemblyVersionShape);
        }

        private static void InformationalVersionShape()
        {
            // [COT-MPU-1]
            string stablePattern = @"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\+[0-9]{8}\.[0-9a-f]{12}$";
            string devPattern = @"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-dev\+[0-9]{8}\.([0-9a-f]{12}|unknown)(\.dirty)?$";

            bool matchesStable = Regex.IsMatch(BuildVersion.InformationalVersion, stablePattern);
            bool matchesDev = Regex.IsMatch(BuildVersion.InformationalVersion, devPattern);
            TestAssert.True(matchesStable || matchesDev, "informational version shape");
        }

        private static void NumericAssemblyVersionShape()
        {
            // [COT-MPU-2]
            string numericPattern = @"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.0$";

            TestAssert.True(Regex.IsMatch(BuildVersion.AssemblyVersion, numericPattern), "assembly version shape");
            TestAssert.True(Regex.IsMatch(BuildVersion.FileVersion, numericPattern), "file version shape");
            TestAssert.True(BuildVersion.PackageVersion.Length > 0, "package version is present");
        }
    }
}
