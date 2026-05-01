using System;
using System.IO;
using System.Runtime.Serialization.Json;

namespace CursorMirror
{
    public sealed class DemoSettingsStore
    {
        private readonly string _path;

        public DemoSettingsStore()
            : this(GetDefaultPath())
        {
        }

        public DemoSettingsStore(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Settings path must not be empty.", "path");
            }

            _path = path;
        }

        public string Path
        {
            get { return _path; }
        }

        public DemoSettings Load()
        {
            string restoreFailureMessage;
            return Load(out restoreFailureMessage);
        }

        public DemoSettings Load(out string restoreFailureMessage)
        {
            try
            {
                restoreFailureMessage = null;
                if (!File.Exists(_path))
                {
                    return DemoSettings.Default();
                }

                return ReadSettings(_path);
            }
            catch (Exception ex)
            {
                restoreFailureMessage = ex.Message;
                return DemoSettings.Default();
            }
        }

        public void Save(DemoSettings settings)
        {
            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            DemoSettings normalized = settings.Normalize();
            string directory = System.IO.Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            using (MemoryStream stream = new MemoryStream())
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(DemoSettings));
                serializer.WriteObject(stream, normalized);
                DurableJsonSettingsFile.Save(
                    _path,
                    stream.ToArray(),
                    delegate(string temporaryPath)
                    {
                        ReadSettings(temporaryPath);
                    });
            }
        }

        private static DemoSettings ReadSettings(string path)
        {
            using (FileStream stream = File.OpenRead(path))
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(DemoSettings));
                DemoSettings settings = serializer.ReadObject(stream) as DemoSettings;
                if (settings == null)
                {
                    throw new InvalidDataException("Settings file did not contain a valid demo settings object.");
                }

                return settings.Normalize();
            }
        }

        private static string GetDefaultPath()
        {
            string root = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrWhiteSpace(root))
            {
                root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            }

            return System.IO.Path.Combine(root, "CursorMirror", "demo-settings.json");
        }
    }
}
