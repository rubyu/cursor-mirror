using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Text.RegularExpressions;

namespace CursorMirror
{
    public enum VersionUpdateState
    {
        Unknown,
        UpToDate,
        Behind,
        DevelopmentBuild,
        AheadOfLatest
    }

    public sealed class VersionUpdateResult
    {
        private VersionUpdateResult(
            VersionUpdateState state,
            string currentVersion,
            string latestVersion,
            int versionsBehind,
            string errorMessage)
        {
            State = state;
            CurrentVersion = currentVersion ?? string.Empty;
            LatestVersion = latestVersion ?? string.Empty;
            VersionsBehind = versionsBehind < 0 ? 0 : versionsBehind;
            ErrorMessage = errorMessage ?? string.Empty;
        }

        public VersionUpdateState State { get; private set; }

        public string CurrentVersion { get; private set; }

        public string LatestVersion { get; private set; }

        public int VersionsBehind { get; private set; }

        public string ErrorMessage { get; private set; }

        public static VersionUpdateResult Unknown(string currentVersion, string errorMessage)
        {
            return new VersionUpdateResult(VersionUpdateState.Unknown, currentVersion, string.Empty, 0, errorMessage);
        }

        internal static VersionUpdateResult Create(
            VersionUpdateState state,
            string currentVersion,
            string latestVersion,
            int versionsBehind)
        {
            return new VersionUpdateResult(state, currentVersion, latestVersion, versionsBehind, string.Empty);
        }
    }

    public interface IVersionUpdateChecker
    {
        VersionUpdateResult Check();
    }

    public sealed class GitHubVersionUpdateChecker : IVersionUpdateChecker
    {
        private const string ReleasesUrl = "https://api.github.com/repos/rubyu/cursor-mirror/releases?per_page=100";
        private const int Tls12ProtocolValue = 3072;
        private const int RequestTimeoutMilliseconds = 5000;

        public VersionUpdateResult Check()
        {
            try
            {
                return VersionUpdateEvaluator.Evaluate(BuildVersion.PackageVersion, DownloadReleaseTags());
            }
            catch (Exception ex)
            {
                return VersionUpdateResult.Unknown(BuildVersion.PackageVersion, ex.Message);
            }
        }

        private static IEnumerable<string> DownloadReleaseTags()
        {
            EnableTls12IfAvailable();
            using (TimeoutWebClient client = new TimeoutWebClient(RequestTimeoutMilliseconds))
            {
                client.Encoding = Encoding.UTF8;
                client.Headers[HttpRequestHeader.UserAgent] = "CursorMirror/" + BuildVersion.PackageVersion;
                client.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";

                string json = client.DownloadString(ReleasesUrl);
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(GitHubReleaseInfo[]));
                using (MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(json)))
                {
                    GitHubReleaseInfo[] releases = serializer.ReadObject(stream) as GitHubReleaseInfo[];
                    List<string> tags = new List<string>();
                    if (releases == null)
                    {
                        return tags;
                    }

                    for (int i = 0; i < releases.Length; i++)
                    {
                        GitHubReleaseInfo release = releases[i];
                        if (release != null && !release.Draft && !release.Prerelease && !string.IsNullOrWhiteSpace(release.TagName))
                        {
                            tags.Add(release.TagName);
                        }
                    }

                    return tags;
                }
            }
        }

        private static void EnableTls12IfAvailable()
        {
            try
            {
                ServicePointManager.SecurityProtocol =
                    ServicePointManager.SecurityProtocol | (SecurityProtocolType)Tls12ProtocolValue;
            }
            catch (NotSupportedException)
            {
            }
        }

        private sealed class TimeoutWebClient : WebClient
        {
            private readonly int _timeoutMilliseconds;

            public TimeoutWebClient(int timeoutMilliseconds)
            {
                _timeoutMilliseconds = timeoutMilliseconds;
            }

            protected override WebRequest GetWebRequest(Uri address)
            {
                WebRequest request = base.GetWebRequest(address);
                if (request != null)
                {
                    request.Timeout = _timeoutMilliseconds;
                    HttpWebRequest httpRequest = request as HttpWebRequest;
                    if (httpRequest != null)
                    {
                        httpRequest.ReadWriteTimeout = _timeoutMilliseconds;
                    }
                }

                return request;
            }
        }

        [DataContract]
        private sealed class GitHubReleaseInfo
        {
            [DataMember(Name = "tag_name")]
            public string TagName { get; set; }

            [DataMember(Name = "draft")]
            public bool Draft { get; set; }

            [DataMember(Name = "prerelease")]
            public bool Prerelease { get; set; }
        }
    }

    public static class VersionUpdateEvaluator
    {
        public static VersionUpdateResult Evaluate(string currentPackageVersion, IEnumerable<string> releaseTags)
        {
            SemanticVersion current;
            bool isDevelopment;
            if (!SemanticVersion.TryParsePackageVersion(currentPackageVersion, out current, out isDevelopment))
            {
                return VersionUpdateResult.Unknown(currentPackageVersion, "Current version is not a supported package version.");
            }

            List<SemanticVersion> releases = ParseStableReleaseTags(releaseTags);
            if (releases.Count == 0)
            {
                return VersionUpdateResult.Unknown(currentPackageVersion, "No stable releases were found.");
            }

            releases.Sort();
            releases.Reverse();

            SemanticVersion latest = releases[0];
            int versionsBehind = CountGreaterThan(releases, current);
            if (isDevelopment)
            {
                return VersionUpdateResult.Create(
                    VersionUpdateState.DevelopmentBuild,
                    currentPackageVersion,
                    latest.Tag,
                    versionsBehind);
            }

            int comparison = current.CompareTo(latest);
            if (comparison == 0)
            {
                return VersionUpdateResult.Create(VersionUpdateState.UpToDate, currentPackageVersion, latest.Tag, 0);
            }

            if (comparison < 0)
            {
                return VersionUpdateResult.Create(
                    VersionUpdateState.Behind,
                    currentPackageVersion,
                    latest.Tag,
                    versionsBehind);
            }

            return VersionUpdateResult.Create(VersionUpdateState.AheadOfLatest, currentPackageVersion, latest.Tag, 0);
        }

        private static List<SemanticVersion> ParseStableReleaseTags(IEnumerable<string> releaseTags)
        {
            List<SemanticVersion> versions = new List<SemanticVersion>();
            if (releaseTags == null)
            {
                return versions;
            }

            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string tag in releaseTags)
            {
                SemanticVersion version;
                if (SemanticVersion.TryParseTag(tag, out version) && seen.Add(version.Tag))
                {
                    versions.Add(version);
                }
            }

            return versions;
        }

        private static int CountGreaterThan(IEnumerable<SemanticVersion> versions, SemanticVersion current)
        {
            int count = 0;
            foreach (SemanticVersion version in versions)
            {
                if (version.CompareTo(current) > 0)
                {
                    count++;
                }
            }

            return count;
        }

        private struct SemanticVersion : IComparable<SemanticVersion>
        {
            private static readonly Regex StableTagPattern = new Regex(
                @"^v(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)$",
                RegexOptions.Compiled | RegexOptions.CultureInvariant);

            private static readonly Regex PackageVersionPattern = new Regex(
                @"^(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)(?<suffix>-dev(?:\..*)?)?$",
                RegexOptions.Compiled | RegexOptions.CultureInvariant);

            public readonly int Major;
            public readonly int Minor;
            public readonly int Patch;
            public readonly string Tag;

            private SemanticVersion(int major, int minor, int patch, string tag)
            {
                Major = major;
                Minor = minor;
                Patch = patch;
                Tag = tag;
            }

            public static bool TryParseTag(string tag, out SemanticVersion version)
            {
                version = default(SemanticVersion);
                if (string.IsNullOrWhiteSpace(tag))
                {
                    return false;
                }

                Match match = StableTagPattern.Match(tag.Trim());
                if (!match.Success)
                {
                    return false;
                }

                int major;
                int minor;
                int patch;
                if (!TryReadParts(match, out major, out minor, out patch))
                {
                    return false;
                }

                version = new SemanticVersion(major, minor, patch, "v" + major + "." + minor + "." + patch);
                return true;
            }

            public static bool TryParsePackageVersion(string packageVersion, out SemanticVersion version, out bool isDevelopment)
            {
                version = default(SemanticVersion);
                isDevelopment = false;
                if (string.IsNullOrWhiteSpace(packageVersion))
                {
                    return false;
                }

                Match match = PackageVersionPattern.Match(packageVersion.Trim());
                if (!match.Success)
                {
                    return false;
                }

                int major;
                int minor;
                int patch;
                if (!TryReadParts(match, out major, out minor, out patch))
                {
                    return false;
                }

                isDevelopment = match.Groups["suffix"].Success;
                version = new SemanticVersion(major, minor, patch, "v" + major + "." + minor + "." + patch);
                return true;
            }

            public int CompareTo(SemanticVersion other)
            {
                int major = Major.CompareTo(other.Major);
                if (major != 0)
                {
                    return major;
                }

                int minor = Minor.CompareTo(other.Minor);
                if (minor != 0)
                {
                    return minor;
                }

                return Patch.CompareTo(other.Patch);
            }

            private static bool TryReadParts(Match match, out int major, out int minor, out int patch)
            {
                major = 0;
                minor = 0;
                patch = 0;

                if (!int.TryParse(match.Groups["major"].Value, out major))
                {
                    return false;
                }

                if (!int.TryParse(match.Groups["minor"].Value, out minor))
                {
                    return false;
                }

                if (!int.TryParse(match.Groups["patch"].Value, out patch))
                {
                    return false;
                }

                return true;
            }
        }
    }
}
