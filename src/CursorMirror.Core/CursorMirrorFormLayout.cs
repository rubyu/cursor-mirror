using System;
using System.Drawing;
using System.Windows.Forms;

namespace CursorMirror
{
    public static class CursorMirrorFormLayout
    {
        public static TableLayoutPanel AddGroup(TableLayoutPanel outerLayout, int column, int row, string title, int rowCount)
        {
            GroupBox group = new GroupBox();
            group.Text = title;
            group.Dock = DockStyle.Fill;
            group.AutoSize = true;
            group.Margin = new Padding(4);
            group.Padding = new Padding(10, 8, 10, 10);
            outerLayout.Controls.Add(group, column, row);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Top;
            layout.AutoSize = true;
            layout.ColumnCount = 2;
            layout.RowCount = rowCount;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 55));
            AddAutoRows(layout, rowCount);
            group.Controls.Add(layout);
            return layout;
        }

        public static void AddAutoRows(TableLayoutPanel layout, int rowCount)
        {
            layout.RowStyles.Clear();
            for (int i = 0; i < rowCount; i++)
            {
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            }
        }

        public static ComboBox AddComboRow(TableLayoutPanel layout, int row, string labelText, out Label label)
        {
            label = AddRowLabel(layout, row, labelText);

            ComboBox input = new ComboBox();
            input.DropDownStyle = ComboBoxStyle.DropDownList;
            input.Anchor = AnchorStyles.Left | AnchorStyles.Right;
            layout.Controls.Add(input, 1, row);
            return input;
        }

        public static NumericUpDown AddNumberRow(TableLayoutPanel layout, int row, string labelText, IntSettingRange range, out Label label)
        {
            return AddNumberRow(layout, row, labelText, range.Minimum, range.Maximum, out label);
        }

        public static NumericUpDown AddNumberRow(TableLayoutPanel layout, int row, string labelText, int minimum, int maximum, out Label label)
        {
            label = AddRowLabel(layout, row, labelText);

            NumericUpDown input = new NumericUpDown();
            input.Minimum = minimum;
            input.Maximum = maximum;
            input.DecimalPlaces = 0;
            input.Anchor = AnchorStyles.Left | AnchorStyles.Right;
            layout.Controls.Add(input, 1, row);
            return input;
        }

        public static NumericUpDown AddNumberRow(
            TableLayoutPanel layout,
            int row,
            string labelText,
            int minimum,
            int maximum,
            int value,
            out Label label)
        {
            NumericUpDown input = AddNumberRow(layout, row, labelText, minimum, maximum, out label);
            input.Value = Math.Max(minimum, Math.Min(maximum, value));
            return input;
        }

        public static CheckBox AddCheckBoxRow(TableLayoutPanel layout, int row, string text)
        {
            CheckBox checkBox = new CheckBox();
            checkBox.Text = text;
            checkBox.AutoSize = true;
            checkBox.Anchor = AnchorStyles.Left;
            layout.Controls.Add(checkBox, 0, row);
            layout.SetColumnSpan(checkBox, 2);
            return checkBox;
        }

        public static Label AddValueRow(TableLayoutPanel layout, int row, string labelText)
        {
            Label label = new Label();
            label.Text = labelText;
            label.AutoSize = false;
            label.AutoEllipsis = true;
            label.Dock = DockStyle.Fill;
            label.TextAlign = ContentAlignment.MiddleLeft;
            label.Margin = new Padding(0, 0, 12, 0);
            layout.Controls.Add(label, 0, row);

            Label value = new Label();
            value.AutoSize = false;
            value.AutoEllipsis = true;
            value.Dock = DockStyle.Fill;
            value.TextAlign = ContentAlignment.MiddleLeft;
            value.Margin = new Padding(0);
            layout.Controls.Add(value, 1, row);
            return value;
        }

        public static Label AddAutoValueRow(TableLayoutPanel layout, int row, string labelText, string valueText)
        {
            Label label = AddRowLabel(layout, row, labelText);

            Label value = new Label();
            value.Text = valueText;
            value.AutoSize = true;
            value.Anchor = AnchorStyles.Left;
            layout.Controls.Add(value, 1, row);
            return value;
        }

        public static void ReplaceItems(ComboBox comboBox, int selectedIndex, params string[] items)
        {
            comboBox.BeginUpdate();
            try
            {
                comboBox.Items.Clear();
                for (int i = 0; i < items.Length; i++)
                {
                    comboBox.Items.Add(items[i]);
                }

                if (items.Length == 0)
                {
                    comboBox.SelectedIndex = -1;
                    return;
                }

                int safeIndex = selectedIndex < 0 ? 0 : Math.Min(selectedIndex, items.Length - 1);
                comboBox.SelectedIndex = safeIndex;
            }
            finally
            {
                comboBox.EndUpdate();
            }
        }

        public static void SetEnabled(bool enabled, params Control[] controls)
        {
            for (int i = 0; i < controls.Length; i++)
            {
                if (controls[i] != null)
                {
                    controls[i].Enabled = enabled;
                }
            }
        }

        private static Label AddRowLabel(TableLayoutPanel layout, int row, string labelText)
        {
            Label label = new Label();
            label.Text = labelText;
            label.AutoSize = true;
            label.Anchor = AnchorStyles.Left;
            layout.Controls.Add(label, 0, row);
            return label;
        }
    }
}
