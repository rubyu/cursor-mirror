using System;
using System.Globalization;
using System.IO;

namespace CursorMirror
{
    public delegate void DurableJsonSettingsValidator(string temporaryPath);

    public static class DurableJsonSettingsFile
    {
        public const int DefaultBackupRetention = 5;

        public static void Save(string path, byte[] content, DurableJsonSettingsValidator validator)
        {
            Save(path, content, validator, DefaultBackupRetention);
        }

        public static void Save(string path, byte[] content, DurableJsonSettingsValidator validator, int backupRetention)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Settings path must not be empty.", "path");
            }

            if (content == null)
            {
                throw new ArgumentNullException("content");
            }

            if (validator == null)
            {
                throw new ArgumentNullException("validator");
            }

            if (backupRetention < 0)
            {
                throw new ArgumentOutOfRangeException("backupRetention");
            }

            string fullPath = Path.GetFullPath(path);
            string directory = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrEmpty(directory))
            {
                directory = Environment.CurrentDirectory;
                fullPath = Path.Combine(directory, Path.GetFileName(fullPath));
            }

            Directory.CreateDirectory(directory);

            string fileName = Path.GetFileName(fullPath);
            string temporaryPath = Path.Combine(directory, fileName + ".tmp." + Guid.NewGuid().ToString("N"));

            try
            {
                File.WriteAllBytes(temporaryPath, content);
                validator(temporaryPath);

                if (File.Exists(fullPath))
                {
                    string backupPath = CreateUniqueBackupPath(directory, fileName);
                    ReplaceExistingFile(temporaryPath, fullPath, backupPath);
                }
                else
                {
                    File.Move(temporaryPath, fullPath);
                }

                CleanupTemporaryFiles(directory, fileName);
                CleanupBackups(directory, fileName, backupRetention);
            }
            catch
            {
                TryDelete(temporaryPath);
                throw;
            }
        }

        private static void ReplaceExistingFile(string temporaryPath, string targetPath, string backupPath)
        {
            try
            {
                File.Replace(temporaryPath, targetPath, backupPath);
            }
            catch (PlatformNotSupportedException)
            {
                ReplaceExistingFileByRename(temporaryPath, targetPath, backupPath);
            }
            catch (NotSupportedException)
            {
                ReplaceExistingFileByRename(temporaryPath, targetPath, backupPath);
            }
            catch (IOException)
            {
                ReplaceExistingFileByRename(temporaryPath, targetPath, backupPath);
            }
            catch (UnauthorizedAccessException)
            {
                ReplaceExistingFileByRename(temporaryPath, targetPath, backupPath);
            }
        }

        private static void ReplaceExistingFileByRename(string temporaryPath, string targetPath, string backupPath)
        {
            bool targetMoved = false;
            try
            {
                File.Move(targetPath, backupPath);
                targetMoved = true;
                File.Move(temporaryPath, targetPath);
            }
            catch
            {
                if (targetMoved && !File.Exists(targetPath) && File.Exists(backupPath))
                {
                    try
                    {
                        File.Move(backupPath, targetPath);
                    }
                    catch
                    {
                    }
                }

                throw;
            }
        }

        private static string CreateUniqueBackupPath(string directory, string fileName)
        {
            string timestamp = DateTime.UtcNow.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture);
            for (int attempt = 0; attempt < 1000; attempt++)
            {
                string suffix = attempt == 0 ? string.Empty : "." + attempt.ToString(CultureInfo.InvariantCulture);
                string backupPath = Path.Combine(directory, fileName + ".bak." + timestamp + suffix);
                if (!File.Exists(backupPath))
                {
                    return backupPath;
                }
            }

            return Path.Combine(directory, fileName + ".bak." + timestamp + "." + Guid.NewGuid().ToString("N"));
        }

        private static void CleanupBackups(string directory, string fileName, int backupRetention)
        {
            string[] backups = Directory.GetFiles(directory, fileName + ".bak.*");
            Array.Sort(backups, StringComparer.OrdinalIgnoreCase);

            int deleteCount = backups.Length - backupRetention;
            for (int i = 0; i < deleteCount; i++)
            {
                TryDelete(backups[i]);
            }
        }

        private static void CleanupTemporaryFiles(string directory, string fileName)
        {
            string[] temporaryFiles = Directory.GetFiles(directory, fileName + ".tmp.*");
            for (int i = 0; i < temporaryFiles.Length; i++)
            {
                TryDelete(temporaryFiles[i]);
            }
        }

        private static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch
            {
            }
        }
    }
}
