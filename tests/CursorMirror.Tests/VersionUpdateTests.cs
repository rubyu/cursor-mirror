using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class VersionUpdateTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MPU-3", UpToDateStableRelease);
            suite.Add("COT-MPU-4", CountsStableReleasesBehind);
            suite.Add("COT-MPU-5", DevelopmentBuildStatus);
            suite.Add("COT-MPU-6", IgnoresInvalidReleaseTags);
        }

        // Up-to-date stable release status [COT-MPU-3]
        private static void UpToDateStableRelease()
        {
            VersionUpdateResult result = VersionUpdateEvaluator.Evaluate(
                "1.2.0",
                new[] { "v1.1.0", "v1.2.0" });

            TestAssert.Equal(VersionUpdateState.UpToDate, result.State, "stable current state");
            TestAssert.Equal("v1.2.0", result.LatestVersion, "stable current latest");
            TestAssert.Equal(0, result.VersionsBehind, "stable current behind count");
        }

        // Counts newer stable releases behind current version [COT-MPU-4]
        private static void CountsStableReleasesBehind()
        {
            VersionUpdateResult result = VersionUpdateEvaluator.Evaluate(
                "1.0.0",
                new[] { "v1.0.0", "v1.1.0", "v1.2.0" });

            TestAssert.Equal(VersionUpdateState.Behind, result.State, "behind state");
            TestAssert.Equal("v1.2.0", result.LatestVersion, "behind latest");
            TestAssert.Equal(2, result.VersionsBehind, "behind count");
        }

        // Development build status [COT-MPU-5]
        private static void DevelopmentBuildStatus()
        {
            VersionUpdateResult result = VersionUpdateEvaluator.Evaluate(
                "1.3.0-dev.20260502.abcdef123456",
                new[] { "v1.1.0", "v1.2.0" });

            TestAssert.Equal(VersionUpdateState.DevelopmentBuild, result.State, "development state");
            TestAssert.Equal("v1.2.0", result.LatestVersion, "development latest");
            TestAssert.Equal(0, result.VersionsBehind, "development behind count");
        }

        // Invalid and prerelease-like tags are ignored [COT-MPU-6]
        private static void IgnoresInvalidReleaseTags()
        {
            VersionUpdateResult result = VersionUpdateEvaluator.Evaluate(
                "1.0.0",
                new[] { "not-a-tag", "v1.1.0-beta", "v1.1.0" });

            TestAssert.Equal(VersionUpdateState.Behind, result.State, "invalid tags ignored state");
            TestAssert.Equal("v1.1.0", result.LatestVersion, "invalid tags ignored latest");
            TestAssert.Equal(1, result.VersionsBehind, "invalid tags ignored behind count");
        }
    }
}
