using System;
using System.Windows.Forms;

namespace CursorMirror
{
    public sealed class ControlDispatcher : IUiDispatcher
    {
        private readonly Control _control;

        public ControlDispatcher(Control control)
        {
            if (control == null)
            {
                throw new ArgumentNullException("control");
            }

            _control = control;
        }

        public bool InvokeRequired
        {
            get { return _control.InvokeRequired; }
        }

        public void BeginInvoke(Action action)
        {
            if (action == null)
            {
                throw new ArgumentNullException("action");
            }

            _control.BeginInvoke(action);
        }
    }
}
