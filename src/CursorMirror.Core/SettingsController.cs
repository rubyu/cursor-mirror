using System;

namespace CursorMirror
{
    public sealed class SettingsController
    {
        private readonly SettingsStore _store;
        private readonly Action<CursorMirrorSettings> _applySettings;
        private readonly Action _exitAction;
        private CursorMirrorSettings _settings;

        public SettingsController(SettingsStore store, CursorMirrorSettings initialSettings, Action<CursorMirrorSettings> applySettings, Action exitAction)
        {
            if (store == null)
            {
                throw new ArgumentNullException("store");
            }

            if (initialSettings == null)
            {
                throw new ArgumentNullException("initialSettings");
            }

            if (applySettings == null)
            {
                throw new ArgumentNullException("applySettings");
            }

            if (exitAction == null)
            {
                throw new ArgumentNullException("exitAction");
            }

            _store = store;
            _applySettings = applySettings;
            _exitAction = exitAction;
            _settings = initialSettings.Normalize();
            _applySettings(_settings.Clone());
        }

        public CursorMirrorSettings CurrentSettings
        {
            get { return _settings.Clone(); }
        }

        public void UpdateSettings(CursorMirrorSettings settings)
        {
            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            _settings = settings.Normalize();
            _store.Save(_settings);
            _applySettings(_settings.Clone());
        }

        public void ResetToDefaults()
        {
            UpdateSettings(CursorMirrorSettings.Default());
        }

        public void Exit()
        {
            _exitAction();
        }
    }
}
