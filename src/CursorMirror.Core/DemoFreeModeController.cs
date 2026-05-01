using System;

namespace CursorMirror
{
    public sealed class DemoFreeModeController
    {
        public const int DefaultResumeAfterMilliseconds = 3000;
        private readonly int _resumeAfterMilliseconds;
        private DemoInputMode _mode = DemoInputMode.Auto;
        private long _lastExternalInputMilliseconds;

        public DemoFreeModeController()
            : this(DefaultResumeAfterMilliseconds)
        {
        }

        public DemoFreeModeController(int resumeAfterMilliseconds)
        {
            if (resumeAfterMilliseconds <= 0)
            {
                throw new ArgumentOutOfRangeException("resumeAfterMilliseconds");
            }

            _resumeAfterMilliseconds = resumeAfterMilliseconds;
        }

        public DemoInputMode Mode
        {
            get { return _mode; }
        }

        public int ResumeAfterMilliseconds
        {
            get { return _resumeAfterMilliseconds; }
        }

        public bool IsAuto
        {
            get { return _mode == DemoInputMode.Auto; }
        }

        public long LastExternalInputMilliseconds
        {
            get { return _lastExternalInputMilliseconds; }
        }

        public void StartAuto()
        {
            _mode = DemoInputMode.Auto;
        }

        public void RecordExternalInput(long nowMilliseconds)
        {
            _mode = DemoInputMode.Free;
            _lastExternalInputMilliseconds = nowMilliseconds;
        }

        public bool Tick(long nowMilliseconds)
        {
            if (_mode != DemoInputMode.Free)
            {
                return false;
            }

            if (nowMilliseconds - _lastExternalInputMilliseconds < _resumeAfterMilliseconds)
            {
                return false;
            }

            _mode = DemoInputMode.Auto;
            return true;
        }

        public int RemainingMilliseconds(long nowMilliseconds)
        {
            if (_mode != DemoInputMode.Free)
            {
                return 0;
            }

            long remaining = _resumeAfterMilliseconds - (nowMilliseconds - _lastExternalInputMilliseconds);
            if (remaining <= 0)
            {
                return 0;
            }

            return remaining > int.MaxValue ? int.MaxValue : (int)remaining;
        }
    }
}
