using System;
using System.IO;
using System.Runtime.Serialization.Json;

namespace CursorMirror
{
    public sealed class SettingsStore
    {
        private readonly string _path;

        public SettingsStore()
            : this(GetDefaultPath())
        {
        }

        public SettingsStore(string path)
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

        public CursorMirrorSettings Load()
        {
            try
            {
                if (!File.Exists(_path))
                {
                    return CursorMirrorSettings.Default();
                }

                using (FileStream stream = File.OpenRead(_path))
                {
                    DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(CursorMirrorSettings));
                    CursorMirrorSettings settings = serializer.ReadObject(stream) as CursorMirrorSettings;
                    if (settings == null)
                    {
                        return CursorMirrorSettings.Default();
                    }

                    return settings.Normalize();
                }
            }
            catch
            {
                return CursorMirrorSettings.Default();
            }
        }

        public void Save(CursorMirrorSettings settings)
        {
            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            CursorMirrorSettings normalized = settings.Normalize();
            string directory = System.IO.Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            using (MemoryStream stream = new MemoryStream())
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(CursorMirrorSettings));
                serializer.WriteObject(stream, normalized);
                File.WriteAllBytes(_path, stream.ToArray());
            }
        }

        private static string GetDefaultPath()
        {
            string root = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrWhiteSpace(root))
            {
                root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            }

            return System.IO.Path.Combine(root, "CursorMirror", "settings.json");
        }
    }
}
