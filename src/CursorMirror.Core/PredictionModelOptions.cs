using System.Windows.Forms;

namespace CursorMirror
{
    public static class PredictionModelOptions
    {
        public static void ReplaceItems(ComboBox comboBox, int selectedModel)
        {
            comboBox.BeginUpdate();
            try
            {
                comboBox.Items.Clear();
                comboBox.Items.Add(LocalizedStrings.PredictionModelOptionText(CursorMirrorSettings.DwmPredictionModelConstantVelocity));
                comboBox.SelectedIndex = IndexOf(selectedModel);
            }
            finally
            {
                comboBox.EndUpdate();
            }
        }

        public static int FromSelection(ComboBox comboBox)
        {
            return CursorMirrorSettings.DwmPredictionModelConstantVelocity;
        }

        public static int IndexOf(int model)
        {
            return 0;
        }
    }
}
