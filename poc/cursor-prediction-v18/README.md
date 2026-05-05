# Cursor Prediction POC v18

v18 focuses on the user-visible acute-stop problem: the mirror cursor appearing to move past the real cursor's current position during rapid stops.

Unlike v17, the primary metric is not shifted-target error. v18 separates:

- current-position displacement and overshoot,
- offset-0 direction signed overshoot,
- candidate shifted-target direction signed overshoot,
- normal visual error to the shifted target.

All heavy evaluation must be CPU/GPU sequential and performed by one worker. Product source is read only.
