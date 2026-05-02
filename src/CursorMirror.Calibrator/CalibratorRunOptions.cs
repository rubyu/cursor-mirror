namespace CursorMirror.Calibrator
{
    public sealed class CalibratorRunOptions
    {
        public bool AutoRun { get; set; }
        public bool ExitAfterRun { get; set; }
        public int DurationSeconds { get; set; }
        public string OutputPath { get; set; }
        public bool? PredictionEnabled { get; set; }
        public int? PredictionGainPercent { get; set; }
        public int? PredictionHorizonMilliseconds { get; set; }
        public int? PredictionIdleResetMilliseconds { get; set; }
        public int? DwmPredictionHorizonCapMilliseconds { get; set; }
        public bool? DwmAdaptiveGainEnabled { get; set; }
        public int? DwmAdaptiveGainPercent { get; set; }
        public int? DwmAdaptiveMinimumSpeedPixelsPerSecond { get; set; }
        public int? DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared { get; set; }
        public int? DwmAdaptiveReversalCooldownSamples { get; set; }
        public int? DwmAdaptiveStableDirectionSamples { get; set; }
        public int? DwmAdaptiveOscillationWindowSamples { get; set; }
        public int? DwmAdaptiveOscillationMinimumReversals { get; set; }
        public int? DwmAdaptiveOscillationMaximumSpanPixels { get; set; }
        public int? DwmAdaptiveOscillationMaximumEfficiencyPercent { get; set; }
        public int? DwmAdaptiveOscillationLatchMilliseconds { get; set; }
        public int? DwmPredictionModel { get; set; }

        public static CalibratorRunOptions FromArguments(string[] args)
        {
            CalibratorRunOptions options = new CalibratorRunOptions();
            options.DurationSeconds = 10;

            if (args == null)
            {
                return options;
            }

            for (int i = 0; i < args.Length; i++)
            {
                string argument = args[i] ?? string.Empty;
                if (argument == "--auto-run")
                {
                    options.AutoRun = true;
                }
                else if (argument == "--exit-after-run")
                {
                    options.ExitAfterRun = true;
                }
                else if (argument == "--duration-seconds" && i + 1 < args.Length)
                {
                    int seconds;
                    if (int.TryParse(args[i + 1], out seconds))
                    {
                        options.DurationSeconds = seconds;
                    }

                    i++;
                }
                else if ((argument == "--output" || argument == "--output-path") && i + 1 < args.Length)
                {
                    options.OutputPath = args[i + 1];
                    i++;
                }
                else if (argument == "--prediction-enabled" && i + 1 < args.Length)
                {
                    bool enabled;
                    if (TryParseBoolean(args[i + 1], out enabled))
                    {
                        options.PredictionEnabled = enabled;
                    }

                    i++;
                }
                else if (argument == "--prediction-disabled")
                {
                    options.PredictionEnabled = false;
                }
                else if ((argument == "--prediction-gain" || argument == "--prediction-gain-percent") && i + 1 < args.Length)
                {
                    int gain;
                    if (int.TryParse(args[i + 1], out gain))
                    {
                        options.PredictionGainPercent = gain;
                    }

                    i++;
                }
                else if ((argument == "--prediction-horizon-ms" || argument == "--prediction-horizon-milliseconds") && i + 1 < args.Length)
                {
                    int horizon;
                    if (int.TryParse(args[i + 1], out horizon))
                    {
                        options.PredictionHorizonMilliseconds = horizon;
                    }

                    i++;
                }
                else if ((argument == "--prediction-idle-reset-ms" || argument == "--prediction-idle-reset-milliseconds") && i + 1 < args.Length)
                {
                    int idleReset;
                    if (int.TryParse(args[i + 1], out idleReset))
                    {
                        options.PredictionIdleResetMilliseconds = idleReset;
                    }

                    i++;
                }
                else if ((argument == "--dwm-horizon-cap-ms" || argument == "--dwm-horizon-cap-milliseconds") && i + 1 < args.Length)
                {
                    int horizonCap;
                    if (int.TryParse(args[i + 1], out horizonCap))
                    {
                        options.DwmPredictionHorizonCapMilliseconds = horizonCap;
                    }

                    i++;
                }
                else if (argument == "--dwm-adaptive-gain-enabled" && i + 1 < args.Length)
                {
                    bool enabled;
                    if (TryParseBoolean(args[i + 1], out enabled))
                    {
                        options.DwmAdaptiveGainEnabled = enabled;
                    }

                    i++;
                }
                else if ((argument == "--dwm-adaptive-gain" || argument == "--dwm-adaptive-gain-percent") && i + 1 < args.Length)
                {
                    int gain;
                    if (int.TryParse(args[i + 1], out gain))
                    {
                        options.DwmAdaptiveGainEnabled = true;
                        options.DwmAdaptiveGainPercent = gain;
                    }

                    i++;
                }
                else if ((argument == "--dwm-adaptive-min-speed" || argument == "--dwm-adaptive-min-speed-px-s") && i + 1 < args.Length)
                {
                    int speed;
                    if (int.TryParse(args[i + 1], out speed))
                    {
                        options.DwmAdaptiveMinimumSpeedPixelsPerSecond = speed;
                    }

                    i++;
                }
                else if ((argument == "--dwm-adaptive-max-accel" || argument == "--dwm-adaptive-max-accel-px-s2") && i + 1 < args.Length)
                {
                    int acceleration;
                    if (int.TryParse(args[i + 1], out acceleration))
                    {
                        options.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared = acceleration;
                    }

                    i++;
                }
                else if (argument == "--dwm-adaptive-reversal-cooldown-samples" && i + 1 < args.Length)
                {
                    int samples;
                    if (int.TryParse(args[i + 1], out samples))
                    {
                        options.DwmAdaptiveReversalCooldownSamples = samples;
                    }

                    i++;
                }
                else if (argument == "--dwm-adaptive-stable-direction-samples" && i + 1 < args.Length)
                {
                    int samples;
                    if (int.TryParse(args[i + 1], out samples))
                    {
                        options.DwmAdaptiveStableDirectionSamples = samples;
                    }

                    i++;
                }
                else if (argument == "--dwm-adaptive-oscillation-window-samples" && i + 1 < args.Length)
                {
                    int samples;
                    if (int.TryParse(args[i + 1], out samples))
                    {
                        options.DwmAdaptiveOscillationWindowSamples = samples;
                    }

                    i++;
                }
                else if (argument == "--dwm-adaptive-oscillation-min-reversals" && i + 1 < args.Length)
                {
                    int reversals;
                    if (int.TryParse(args[i + 1], out reversals))
                    {
                        options.DwmAdaptiveOscillationMinimumReversals = reversals;
                    }

                    i++;
                }
                else if (argument == "--dwm-adaptive-oscillation-max-span-px" && i + 1 < args.Length)
                {
                    int span;
                    if (int.TryParse(args[i + 1], out span))
                    {
                        options.DwmAdaptiveOscillationMaximumSpanPixels = span;
                    }

                    i++;
                }
                else if (argument == "--dwm-adaptive-oscillation-max-efficiency-percent" && i + 1 < args.Length)
                {
                    int efficiency;
                    if (int.TryParse(args[i + 1], out efficiency))
                    {
                        options.DwmAdaptiveOscillationMaximumEfficiencyPercent = efficiency;
                    }

                    i++;
                }
                else if ((argument == "--dwm-adaptive-oscillation-latch-ms" || argument == "--dwm-adaptive-oscillation-latch-milliseconds") && i + 1 < args.Length)
                {
                    int milliseconds;
                    if (int.TryParse(args[i + 1], out milliseconds))
                    {
                        options.DwmAdaptiveOscillationLatchMilliseconds = milliseconds;
                    }

                    i++;
                }
                else if (argument == "--dwm-prediction-model" && i + 1 < args.Length)
                {
                    int model;
                    if (TryParsePredictionModel(args[i + 1], out model))
                    {
                        options.DwmPredictionModel = model;
                    }

                    i++;
                }
                else if (argument == "--dwm-lsq-predictor")
                {
                    options.DwmPredictionModel = CursorMirrorSettings.DwmPredictionModelLeastSquares;
                }
            }

            if (options.DurationSeconds < 3)
            {
                options.DurationSeconds = 3;
            }

            if (options.DurationSeconds > 60)
            {
                options.DurationSeconds = 60;
            }

            return options;
        }

        private static bool TryParseBoolean(string value, out bool result)
        {
            if (bool.TryParse(value, out result))
            {
                return true;
            }

            string normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized == "1" || normalized == "yes" || normalized == "on")
            {
                result = true;
                return true;
            }

            if (normalized == "0" || normalized == "no" || normalized == "off")
            {
                result = false;
                return true;
            }

            result = false;
            return false;
        }

        private static bool TryParsePredictionModel(string value, out int model)
        {
            string normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized == "lsq" || normalized == "least-squares" || normalized == "least_squares")
            {
                model = CursorMirrorSettings.DwmPredictionModelLeastSquares;
                return true;
            }

            if (normalized == "constant" || normalized == "constant-velocity" || normalized == "constant_velocity")
            {
                model = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
                return true;
            }

            if (int.TryParse(value, out model))
            {
                return true;
            }

            model = CursorMirrorSettings.DwmPredictionModelConstantVelocity;
            return false;
        }
    }
}
