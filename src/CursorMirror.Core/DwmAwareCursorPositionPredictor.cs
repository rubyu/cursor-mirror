using System;
using System.Drawing;

namespace CursorMirror
{
    public sealed class DwmAwareCursorPositionPredictor
    {
        public const double DefaultGain = CursorMirrorSettings.DefaultPredictionGainPercent / 100.0;
        private const double FastLinearOverrideMinimumSpeedPixelsPerSecond = 2400.0;
        private const int FastLinearOverrideStableDirectionSamples = 4;
        private const int FastLinearOverrideWindowSamples = 18;
        private const double FastLinearOverrideMinimumEfficiencyPercent = 75.0;
        private const double FastLinearOverrideMinimumNetPixels = 160.0;
        private const double ConstantVelocityMaximumPredictionPixels = 12.0;
        private const double ConstantVelocityHighSpeedMaximumPredictionPixels = 24.0;
        private const double ConstantVelocityHighSpeedMinimumPixelsPerSecond = 2400.0;
        private const int ConstantVelocityHighSpeedWindowSamples = 18;
        private const double ConstantVelocityHighSpeedMinimumEfficiencyPercent = 75.0;
        private const double ConstantVelocityHighSpeedMinimumNetPixels = 160.0;
        private const int HistoryCapacity = 64;
        private const int LeastSquaresDefaultHorizonCapMilliseconds = 8;
        private const int LeastSquaresWindowMilliseconds = 72;
        private const int LeastSquaresMinimumSamples = 4;
        private const double LeastSquaresMinimumEfficiencyPercent = 75.0;
        private const int LeastSquaresJitterWindowMilliseconds = 300;
        private const int LeastSquaresJitterMaximumSpanPixels = 380;
        private const int LeastSquaresJitterMinimumReversals = 2;
        private const double LeastSquaresJitterMaximumEfficiencyPercent = 55.0;
        private const int LeastSquaresFreshSampleRequirement = 6;
        private const int LeastSquaresResetGapMilliseconds = 48;
        private const double LeastSquaresResetSpeedPixelsPerSecond = 6000.0;
        private const double LeastSquaresResetDisplacementPixels = 240.0;
        private const int LeastSquaresResetLowHorizonMilliseconds = 2;
        private const int LeastSquaresResetLowHorizonDurationMilliseconds = 120;
        private const double LeastSquaresLowSpeedHorizonPixelsPerSecond = 450.0;
        private const double LeastSquaresLowNetHorizonPixels = 32.0;
        private const double LeastSquaresMaximumPredictionPixels = 48.0;
        private const double LeastSquaresNetDisplacementScale = 0.8;
        private const double ExperimentalMlpPathWindowMilliseconds = 72.0;
        private const double ExperimentalMlpFeatureHorizonScaleMilliseconds = 16.67;
        private const double ExperimentalMlpApplyMaximumSpeedPixelsPerSecond = 1000.0;
        private const double DistilledMlpMinimumRefreshMilliseconds = 14.0;
        private const double DistilledMlpMaximumRefreshMilliseconds = 19.5;
        private const double DistilledMlpMaximumPredictionPixels = 48.0;
        private const double DistilledMlpStepBaselineHorizonOffsetMilliseconds = -2.0;
        private const double DistilledMlpStepBaselineMaximumPredictionPixels = 12.0;
        private const double DistilledMlpStepBaselineMinimumEfficiency = 0.35;
        private const double DistilledMlpStepBaselineMinimumSpeedPixelsPerSecond = 25.0;
        private const double DistilledMlpStationaryMaximumSpeedPixelsPerSecond = 25.0;
        private const double DistilledMlpStationaryMaximumNetPixels = 0.75;
        private const double DistilledMlpStationaryMaximumPathPixels = 1.5;
        private readonly double[] _historyX = new double[HistoryCapacity + 1];
        private readonly double[] _historyY = new double[HistoryCapacity + 1];
        private readonly long[] _historyTimestampTicks = new long[HistoryCapacity + 1];
        private readonly ExperimentalMlpPredictionModel _experimentalMlpPredictionModel = new ExperimentalMlpPredictionModel();
        private readonly float[] _experimentalMlpTeacherInput = new float[ExperimentalMlpPredictionModel.TeacherInputCount];
        private readonly DistilledMlpPredictionModel _distilledMlpPredictionModel = new DistilledMlpPredictionModel();
        private readonly float[] _distilledMlpScalarInput = new float[DistilledMlpPredictionModel.ScalarFeatureCount];
        private readonly float[] _distilledMlpSequenceInput = new float[DistilledMlpPredictionModel.SequenceLength * DistilledMlpPredictionModel.SequenceFeatureCount];
        private bool _hasSample;
        private double _lastX;
        private double _lastY;
        private long _lastTimestampTicks;
        private int _idleResetMilliseconds;
        private double _gain;
        private int _horizonCapMilliseconds;
        private bool _adaptiveGainEnabled;
        private double _adaptiveGain;
        private int _adaptiveMinimumSpeedPixelsPerSecond;
        private int _adaptiveMaximumAccelerationPixelsPerSecondSquared;
        private int _adaptiveReversalCooldownSamples;
        private bool _hasVelocity;
        private double _lastVelocityXPerSecond;
        private double _lastVelocityYPerSecond;
        private int _samplesSinceDirectionReversal;
        private int _stableDirectionSampleCount;
        private int _adaptiveStableDirectionSamples;
        private int _adaptiveOscillationWindowSamples;
        private int _adaptiveOscillationMinimumReversals;
        private int _adaptiveOscillationMaximumSpanPixels;
        private int _adaptiveOscillationMaximumEfficiencyPercent;
        private int _adaptiveOscillationLatchMilliseconds;
        private int _predictionModel;
        private int _targetOffsetMilliseconds;
        private int _historyCount;
        private int _historyNextIndex;
        private long _oscillationLatchUntilTicks;
        private int _leastSquaresFreshSampleCount;
        private long _leastSquaresLowHorizonUntilTicks;

        public DwmAwareCursorPositionPredictor(int idleResetMilliseconds)
            : this(idleResetMilliseconds, CursorMirrorSettings.DefaultPredictionGainPercent)
        {
        }

        public DwmAwareCursorPositionPredictor(int idleResetMilliseconds, int predictionGainPercent)
            : this(idleResetMilliseconds, predictionGainPercent, CursorMirrorSettings.DefaultDwmPredictionHorizonCapMilliseconds)
        {
        }

        public DwmAwareCursorPositionPredictor(int idleResetMilliseconds, int predictionGainPercent, int horizonCapMilliseconds)
        {
            ApplySettings(
                idleResetMilliseconds,
                predictionGainPercent,
                horizonCapMilliseconds,
                CursorMirrorSettings.DefaultDwmAdaptiveGainEnabled,
                CursorMirrorSettings.DefaultDwmAdaptiveGainPercent,
                CursorMirrorSettings.DefaultDwmAdaptiveMinimumSpeedPixelsPerSecond,
                CursorMirrorSettings.DefaultDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared,
                CursorMirrorSettings.DefaultDwmAdaptiveReversalCooldownSamples);
        }

        public DwmAwareCursorPositionPredictor(
            int idleResetMilliseconds,
            int predictionGainPercent,
            int horizonCapMilliseconds,
            bool adaptiveGainEnabled,
            int adaptiveGainPercent,
            int adaptiveMinimumSpeedPixelsPerSecond,
            int adaptiveMaximumAccelerationPixelsPerSecondSquared)
            : this(
                idleResetMilliseconds,
                predictionGainPercent,
                horizonCapMilliseconds,
                adaptiveGainEnabled,
                adaptiveGainPercent,
                adaptiveMinimumSpeedPixelsPerSecond,
                adaptiveMaximumAccelerationPixelsPerSecondSquared,
                CursorMirrorSettings.DefaultDwmAdaptiveReversalCooldownSamples)
        {
        }

        public DwmAwareCursorPositionPredictor(
            int idleResetMilliseconds,
            int predictionGainPercent,
            int horizonCapMilliseconds,
            bool adaptiveGainEnabled,
            int adaptiveGainPercent,
            int adaptiveMinimumSpeedPixelsPerSecond,
            int adaptiveMaximumAccelerationPixelsPerSecondSquared,
            int adaptiveReversalCooldownSamples)
        {
            ApplySettings(
                idleResetMilliseconds,
                predictionGainPercent,
                horizonCapMilliseconds,
                adaptiveGainEnabled,
                adaptiveGainPercent,
                adaptiveMinimumSpeedPixelsPerSecond,
                adaptiveMaximumAccelerationPixelsPerSecondSquared,
                adaptiveReversalCooldownSamples);
        }

        public void ApplySettings(int idleResetMilliseconds, int predictionGainPercent)
        {
            ApplySettings(idleResetMilliseconds, predictionGainPercent, CursorMirrorSettings.DefaultDwmPredictionHorizonCapMilliseconds);
        }

        public void ApplySettings(CursorMirrorSettings settings)
        {
            if (settings == null)
            {
                throw new ArgumentNullException("settings");
            }

            CursorMirrorSettings normalized = settings.Normalize();
            ApplySettings(
                normalized.PredictionIdleResetMilliseconds,
                normalized.PredictionGainPercent,
                normalized.DwmPredictionHorizonCapMilliseconds,
                normalized.DwmAdaptiveGainEnabled,
                normalized.DwmAdaptiveGainPercent,
                normalized.DwmAdaptiveMinimumSpeedPixelsPerSecond,
                normalized.DwmAdaptiveMaximumAccelerationPixelsPerSecondSquared,
                normalized.DwmAdaptiveReversalCooldownSamples);
            ApplyAdaptiveOscillationSettings(
                normalized.DwmAdaptiveStableDirectionSamples,
                normalized.DwmAdaptiveOscillationWindowSamples,
                normalized.DwmAdaptiveOscillationMinimumReversals,
                normalized.DwmAdaptiveOscillationMaximumSpanPixels,
                normalized.DwmAdaptiveOscillationMaximumEfficiencyPercent,
                normalized.DwmAdaptiveOscillationLatchMilliseconds);
            ApplyPredictionModel(normalized.DwmPredictionModel);
            ApplyPredictionTargetOffsetMilliseconds(normalized.DwmPredictionTargetOffsetMilliseconds);
        }

        public void ApplySettings(int idleResetMilliseconds, int predictionGainPercent, int horizonCapMilliseconds)
        {
            ApplySettings(
                idleResetMilliseconds,
                predictionGainPercent,
                horizonCapMilliseconds,
                CursorMirrorSettings.DefaultDwmAdaptiveGainEnabled,
                CursorMirrorSettings.DefaultDwmAdaptiveGainPercent,
                CursorMirrorSettings.DefaultDwmAdaptiveMinimumSpeedPixelsPerSecond,
                CursorMirrorSettings.DefaultDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared,
                CursorMirrorSettings.DefaultDwmAdaptiveReversalCooldownSamples);
        }

        public void ApplySettings(
            int idleResetMilliseconds,
            int predictionGainPercent,
            int horizonCapMilliseconds,
            bool adaptiveGainEnabled,
            int adaptiveGainPercent,
            int adaptiveMinimumSpeedPixelsPerSecond,
            int adaptiveMaximumAccelerationPixelsPerSecondSquared)
        {
            ApplySettings(
                idleResetMilliseconds,
                predictionGainPercent,
                horizonCapMilliseconds,
                adaptiveGainEnabled,
                adaptiveGainPercent,
                adaptiveMinimumSpeedPixelsPerSecond,
                adaptiveMaximumAccelerationPixelsPerSecondSquared,
                CursorMirrorSettings.DefaultDwmAdaptiveReversalCooldownSamples);
        }

        public void ApplySettings(
            int idleResetMilliseconds,
            int predictionGainPercent,
            int horizonCapMilliseconds,
            bool adaptiveGainEnabled,
            int adaptiveGainPercent,
            int adaptiveMinimumSpeedPixelsPerSecond,
            int adaptiveMaximumAccelerationPixelsPerSecondSquared,
            int adaptiveReversalCooldownSamples)
        {
            ApplyIdleResetMilliseconds(idleResetMilliseconds);
            ApplyPredictionGainPercent(predictionGainPercent);
            ApplyHorizonCapMilliseconds(horizonCapMilliseconds);
            ApplyAdaptiveGainSettings(
                adaptiveGainEnabled,
                adaptiveGainPercent,
                adaptiveMinimumSpeedPixelsPerSecond,
                adaptiveMaximumAccelerationPixelsPerSecondSquared,
                adaptiveReversalCooldownSamples);
            ApplyPredictionModel(CursorMirrorSettings.DefaultDwmPredictionModel);
        }

        public void ApplyIdleResetMilliseconds(int idleResetMilliseconds)
        {
            _idleResetMilliseconds = Math.Max(1, idleResetMilliseconds);
            Reset();
        }

        public void ApplyPredictionGainPercent(int predictionGainPercent)
        {
            _gain = Math.Max(
                CursorMirrorSettings.MinimumPredictionGainPercent,
                Math.Min(CursorMirrorSettings.MaximumPredictionGainPercent, predictionGainPercent)) / 100.0;
        }

        public void ApplyHorizonCapMilliseconds(int horizonCapMilliseconds)
        {
            _horizonCapMilliseconds = Math.Max(
                CursorMirrorSettings.MinimumDwmPredictionHorizonCapMilliseconds,
                Math.Min(CursorMirrorSettings.MaximumDwmPredictionHorizonCapMilliseconds, horizonCapMilliseconds));
        }

        public void ApplyAdaptiveGainSettings(
            bool adaptiveGainEnabled,
            int adaptiveGainPercent,
            int adaptiveMinimumSpeedPixelsPerSecond,
            int adaptiveMaximumAccelerationPixelsPerSecondSquared)
        {
            ApplyAdaptiveGainSettings(
                adaptiveGainEnabled,
                adaptiveGainPercent,
                adaptiveMinimumSpeedPixelsPerSecond,
                adaptiveMaximumAccelerationPixelsPerSecondSquared,
                CursorMirrorSettings.DefaultDwmAdaptiveReversalCooldownSamples);
        }

        public void ApplyAdaptiveGainSettings(
            bool adaptiveGainEnabled,
            int adaptiveGainPercent,
            int adaptiveMinimumSpeedPixelsPerSecond,
            int adaptiveMaximumAccelerationPixelsPerSecondSquared,
            int adaptiveReversalCooldownSamples)
        {
            _adaptiveGainEnabled = adaptiveGainEnabled;
            _adaptiveGain = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveGainPercent,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveGainPercent, adaptiveGainPercent)) / 100.0;
            _adaptiveMinimumSpeedPixelsPerSecond = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveMinimumSpeedPixelsPerSecond,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveMinimumSpeedPixelsPerSecond, adaptiveMinimumSpeedPixelsPerSecond));
            _adaptiveMaximumAccelerationPixelsPerSecondSquared = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveMaximumAccelerationPixelsPerSecondSquared, adaptiveMaximumAccelerationPixelsPerSecondSquared));
            _adaptiveReversalCooldownSamples = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveReversalCooldownSamples,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveReversalCooldownSamples, adaptiveReversalCooldownSamples));
            ApplyAdaptiveOscillationSettings(
                CursorMirrorSettings.DefaultDwmAdaptiveStableDirectionSamples,
                CursorMirrorSettings.DefaultDwmAdaptiveOscillationWindowSamples,
                CursorMirrorSettings.DefaultDwmAdaptiveOscillationMinimumReversals,
                CursorMirrorSettings.DefaultDwmAdaptiveOscillationMaximumSpanPixels,
                CursorMirrorSettings.DefaultDwmAdaptiveOscillationMaximumEfficiencyPercent,
                CursorMirrorSettings.DefaultDwmAdaptiveOscillationLatchMilliseconds);
            ApplyPredictionTargetOffsetMilliseconds(CursorMirrorSettings.DefaultDwmPredictionTargetOffsetMilliseconds);
        }

        public void ApplyAdaptiveOscillationSettings(
            int adaptiveStableDirectionSamples,
            int adaptiveOscillationWindowSamples,
            int adaptiveOscillationMinimumReversals,
            int adaptiveOscillationMaximumSpanPixels,
            int adaptiveOscillationMaximumEfficiencyPercent,
            int adaptiveOscillationLatchMilliseconds)
        {
            _adaptiveStableDirectionSamples = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveStableDirectionSamples,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveStableDirectionSamples, adaptiveStableDirectionSamples));
            _adaptiveOscillationWindowSamples = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveOscillationWindowSamples,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveOscillationWindowSamples, adaptiveOscillationWindowSamples));
            _adaptiveOscillationMinimumReversals = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveOscillationMinimumReversals,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveOscillationMinimumReversals, adaptiveOscillationMinimumReversals));
            _adaptiveOscillationMaximumSpanPixels = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveOscillationMaximumSpanPixels,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveOscillationMaximumSpanPixels, adaptiveOscillationMaximumSpanPixels));
            _adaptiveOscillationMaximumEfficiencyPercent = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveOscillationMaximumEfficiencyPercent,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveOscillationMaximumEfficiencyPercent, adaptiveOscillationMaximumEfficiencyPercent));
            _adaptiveOscillationLatchMilliseconds = Math.Max(
                CursorMirrorSettings.MinimumDwmAdaptiveOscillationLatchMilliseconds,
                Math.Min(CursorMirrorSettings.MaximumDwmAdaptiveOscillationLatchMilliseconds, adaptiveOscillationLatchMilliseconds));
        }

        public void ApplyPredictionModel(int predictionModel)
        {
            _predictionModel = Math.Max(
                CursorMirrorSettings.MinimumDwmPredictionModel,
                Math.Min(CursorMirrorSettings.MaximumDwmPredictionModel, predictionModel));
        }

        public void ApplyPredictionTargetOffsetMilliseconds(int targetOffsetMilliseconds)
        {
            _targetOffsetMilliseconds = Math.Max(
                CursorMirrorSettings.MinimumDwmPredictionTargetOffsetMilliseconds,
                Math.Min(CursorMirrorSettings.MaximumDwmPredictionTargetOffsetMilliseconds, targetOffsetMilliseconds));
        }

        public void Reset()
        {
            _hasSample = false;
            _lastX = 0;
            _lastY = 0;
            _lastTimestampTicks = 0;
            _hasVelocity = false;
            _lastVelocityXPerSecond = 0;
            _lastVelocityYPerSecond = 0;
            _samplesSinceDirectionReversal = int.MaxValue;
            _stableDirectionSampleCount = 0;
            _historyCount = 0;
            _historyNextIndex = 0;
            _oscillationLatchUntilTicks = 0;
            _leastSquaresFreshSampleCount = 0;
            _leastSquaresLowHorizonUntilTicks = 0;
        }

        public Point PredictRounded(CursorPollSample sample, CursorPredictionCounters counters)
        {
            return PredictRounded(sample, counters, 0, 0);
        }

        public Point PredictRounded(CursorPollSample sample, CursorPredictionCounters counters, long targetVBlankTicks, long refreshPeriodTicks)
        {
            PointF predicted = Predict(sample, counters, targetVBlankTicks, refreshPeriodTicks);
            return new Point(
                (int)Math.Round(predicted.X),
                (int)Math.Round(predicted.Y));
        }

        public PointF Predict(CursorPollSample sample, CursorPredictionCounters counters)
        {
            return Predict(sample, counters, 0, 0);
        }

        public PointF Predict(CursorPollSample sample, CursorPredictionCounters counters, long targetVBlankTicks, long refreshPeriodTicks)
        {
            if (counters == null)
            {
                throw new ArgumentNullException("counters");
            }

            if (!_hasSample)
            {
                StoreSample(sample);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            long deltaTicks = sample.TimestampTicks - _lastTimestampTicks;
            if (deltaTicks <= 0 || IsIdleGap(deltaTicks, sample.StopwatchFrequency))
            {
                counters.PredictionResetDueToInvalidDtOrIdleGap++;
                counters.FallbackToHold++;
                StoreSample(sample);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            double deltaSeconds = deltaTicks / (double)sample.StopwatchFrequency;
            if (deltaSeconds <= 0)
            {
                counters.PredictionResetDueToInvalidDtOrIdleGap++;
                counters.FallbackToHold++;
                StoreSample(sample);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            double velocityXPerSecond = (sample.Position.X - _lastX) / deltaSeconds;
            double velocityYPerSecond = (sample.Position.Y - _lastY) / deltaSeconds;
            long nextVBlankTicks = SelectPredictionTargetVBlank(sample, counters, targetVBlankTicks, refreshPeriodTicks);
            nextVBlankTicks = ApplyTargetOffset(nextVBlankTicks, sample.StopwatchFrequency);
            if (nextVBlankTicks <= 0)
            {
                counters.FallbackToHold++;
                StoreSample(sample, velocityXPerSecond, velocityYPerSecond);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            long horizonTicks = nextVBlankTicks - sample.TimestampTicks;
            long effectiveRefreshPeriodTicks = ResolveRefreshPeriodTicks(sample, refreshPeriodTicks);
            if (horizonTicks <= 0 || effectiveRefreshPeriodTicks <= 0 || (double)horizonTicks > effectiveRefreshPeriodTicks * 1.25)
            {
                counters.HorizonOver125xRefreshPeriod++;
                counters.FallbackToHold++;
                StoreSample(sample, velocityXPerSecond, velocityYPerSecond);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            horizonTicks = ApplyHorizonCap(horizonTicks, sample.StopwatchFrequency);
            if (_predictionModel == CursorMirrorSettings.DwmPredictionModelLeastSquares)
            {
                horizonTicks = ApplyLeastSquaresDefaultHorizonCap(horizonTicks, sample.StopwatchFrequency);
                PointF leastSquaresPrediction;
                if (TryPredictLeastSquares(sample, horizonTicks, out leastSquaresPrediction))
                {
                    StoreSample(sample, velocityXPerSecond, velocityYPerSecond);
                    return leastSquaresPrediction;
                }

                counters.FallbackToHold++;
                StoreSample(sample, velocityXPerSecond, velocityYPerSecond);
                return new PointF(sample.Position.X, sample.Position.Y);
            }

            double effectiveGain = SelectGain(sample, velocityXPerSecond, velocityYPerSecond, deltaSeconds);
            bool useHighSpeedLinearCap = ShouldUseHighSpeedConstantVelocityCap(sample, velocityXPerSecond, velocityYPerSecond);
            double scale = effectiveGain * horizonTicks / deltaTicks;
            double dxConstantVelocity = (sample.Position.X - _lastX) * scale;
            double dyConstantVelocity = (sample.Position.Y - _lastY) * scale;
            double maximumPredictionPixels = useHighSpeedLinearCap ? ConstantVelocityHighSpeedMaximumPredictionPixels : ConstantVelocityMaximumPredictionPixels;
            ClampVector(ref dxConstantVelocity, ref dyConstantVelocity, maximumPredictionPixels);
            double predictedX = sample.Position.X + dxConstantVelocity;
            double predictedY = sample.Position.Y + dyConstantVelocity;
            if (_predictionModel == CursorMirrorSettings.DwmPredictionModelDistilledMlp)
            {
                float distilledDx;
                float distilledDy;
                if (TryEvaluateDistilledMlpPrediction(
                    sample,
                    horizonTicks,
                    effectiveRefreshPeriodTicks,
                    out distilledDx,
                    out distilledDy))
                {
                    predictedX = sample.Position.X + distilledDx;
                    predictedY = sample.Position.Y + distilledDy;
                }
            }
            else if (_predictionModel == CursorMirrorSettings.DwmPredictionModelExperimentalMlp)
            {
                float correctionX;
                float correctionY;
                float gateProbability;
                double horizonMilliseconds = horizonTicks * 1000.0 / sample.StopwatchFrequency;
                if (TryEvaluateExperimentalMlpPrediction(
                    counters,
                    sample,
                    horizonMilliseconds,
                    velocityXPerSecond,
                    velocityYPerSecond,
                    dxConstantVelocity,
                    dyConstantVelocity,
                    out correctionX,
                    out correctionY,
                    out gateProbability))
                {
                    predictedX += correctionX;
                    predictedY += correctionY;
                }
            }

            StoreSample(sample, velocityXPerSecond, velocityYPerSecond);
            return new PointF((float)predictedX, (float)predictedY);
        }

        private bool TryEvaluateExperimentalMlpPrediction(
            CursorPredictionCounters counters,
            CursorPollSample sample,
            double horizonMilliseconds,
            double velocityXPerSecond,
            double velocityYPerSecond,
            double baselineDisplacementX,
            double baselineDisplacementY,
            out float correctionX,
            out float correctionY,
            out float gateProbability)
        {
            correctionX = 0.0f;
            correctionY = 0.0f;
            gateProbability = 0.0f;
            if (_historyCount < 4 || sample.StopwatchFrequency <= 0 || horizonMilliseconds <= 0)
            {
                return false;
            }

            double speed = Magnitude(velocityXPerSecond, velocityYPerSecond);
            if (speed >= ExperimentalMlpApplyMaximumSpeedPixelsPerSecond)
            {
                counters.ExperimentalMlpSkippedByRecentSpeed++;
                return false;
            }

            ExperimentalMlpPathAnalysis pathAnalysis;
            if (!TryAnalyzeExperimentalMlpPath(sample, out pathAnalysis))
            {
                pathAnalysis = new ExperimentalMlpPathAnalysis();
            }
            else if (pathAnalysis.Net * 1000.0 / ExperimentalMlpPathWindowMilliseconds >= ExperimentalMlpApplyMaximumSpeedPixelsPerSecond)
            {
                counters.ExperimentalMlpSkippedByPathSpeed++;
                return false;
            }

            FillExperimentalMlpTeacherInput(
                sample,
                horizonMilliseconds,
                velocityXPerSecond,
                velocityYPerSecond,
                speed,
                pathAnalysis,
                baselineDisplacementX,
                baselineDisplacementY);

            double alphaBetaCorrectionX;
            double alphaBetaCorrectionY;
            ComputeExperimentalMlpAlphaBetaCorrection(
                sample,
                horizonMilliseconds,
                velocityXPerSecond,
                velocityYPerSecond,
                speed,
                baselineDisplacementX,
                baselineDisplacementY,
                out alphaBetaCorrectionX,
                out alphaBetaCorrectionY);

            double baselineDisplacement = Magnitude(baselineDisplacementX, baselineDisplacementY);
            counters.ExperimentalMlpEvaluated++;
            if (_experimentalMlpPredictionModel.TryEvaluate(
                _experimentalMlpTeacherInput,
                (float)alphaBetaCorrectionX,
                (float)alphaBetaCorrectionY,
                (float)baselineDisplacement,
                (float)pathAnalysis.Efficiency,
                (float)(speed / 5000.0),
                (float)horizonMilliseconds,
                out correctionX,
                out correctionY,
                out gateProbability))
            {
                counters.ExperimentalMlpApplied++;
                return true;
            }

            counters.ExperimentalMlpRejected++;
            return false;
        }

        private void FillExperimentalMlpTeacherInput(
            CursorPollSample sample,
            double horizonMilliseconds,
            double velocityXPerSecond,
            double velocityYPerSecond,
            double speed,
            ExperimentalMlpPathAnalysis pathAnalysis,
            double baselineDisplacementX,
            double baselineDisplacementY)
        {
            Array.Clear(_experimentalMlpTeacherInput, 0, _experimentalMlpTeacherInput.Length);
            int priorCount = Math.Min(_historyCount, ExperimentalMlpPredictionModel.SequenceLength - 1);
            int totalCount = priorCount + 1;
            int outputRow = ExperimentalMlpPredictionModel.SequenceLength - totalCount;
            double previousX = priorCount > 0 ? _historyX[PriorHistoryIndex(0, priorCount)] : sample.Position.X;
            double previousY = priorCount > 0 ? _historyY[PriorHistoryIndex(0, priorCount)] : sample.Position.Y;
            long previousTicks = priorCount > 0 ? _historyTimestampTicks[PriorHistoryIndex(0, priorCount)] : sample.TimestampTicks;

            for (int i = 0; i < priorCount; i++)
            {
                int historyIndex = PriorHistoryIndex(i, priorCount);
                FillExperimentalMlpSequenceRow(
                    outputRow++,
                    _historyX[historyIndex],
                    _historyY[historyIndex],
                    _historyTimestampTicks[historyIndex],
                    sample,
                    ref previousX,
                    ref previousY,
                    ref previousTicks);
            }

            FillExperimentalMlpSequenceRow(
                outputRow,
                sample.Position.X,
                sample.Position.Y,
                sample.TimestampTicks,
                sample,
                ref previousX,
                ref previousY,
                ref previousTicks);

            int contextOffset = ExperimentalMlpPredictionModel.SequenceLength * ExperimentalMlpPredictionModel.SequenceFeatureCount;
            double baselineDisplacement = Magnitude(baselineDisplacementX, baselineDisplacementY);
            _experimentalMlpTeacherInput[contextOffset] = (float)(horizonMilliseconds / ExperimentalMlpFeatureHorizonScaleMilliseconds);
            _experimentalMlpTeacherInput[contextOffset + 1] = (float)(velocityXPerSecond / 5000.0);
            _experimentalMlpTeacherInput[contextOffset + 2] = (float)(velocityYPerSecond / 5000.0);
            _experimentalMlpTeacherInput[contextOffset + 3] = (float)(speed / 5000.0);
            _experimentalMlpTeacherInput[contextOffset + 4] = (float)Math.Max(0.0, Math.Min(1.0, pathAnalysis.Efficiency));
            _experimentalMlpTeacherInput[contextOffset + 5] = (float)(Math.Min(pathAnalysis.Reversals, 5) / 5.0);
            _experimentalMlpTeacherInput[contextOffset + 6] = (float)(baselineDisplacementX / 24.0);
            _experimentalMlpTeacherInput[contextOffset + 7] = (float)(baselineDisplacementY / 24.0);
            _experimentalMlpTeacherInput[contextOffset + 8] = (float)(baselineDisplacement / 24.0);
        }

        private void FillExperimentalMlpSequenceRow(
            int row,
            double x,
            double y,
            long timestampTicks,
            CursorPollSample currentSample,
            ref double previousX,
            ref double previousY,
            ref long previousTicks)
        {
            double dtMilliseconds = Math.Max(0.0, (timestampTicks - previousTicks) * 1000.0 / currentSample.StopwatchFrequency);
            double dx = x - previousX;
            double dy = y - previousY;
            double velocityX = dtMilliseconds > 0 ? dx / (dtMilliseconds / 1000.0) : 0.0;
            double velocityY = dtMilliseconds > 0 ? dy / (dtMilliseconds / 1000.0) : 0.0;
            double ageMilliseconds = (currentSample.TimestampTicks - timestampTicks) * 1000.0 / currentSample.StopwatchFrequency;
            int offset = row * ExperimentalMlpPredictionModel.SequenceFeatureCount;
            _experimentalMlpTeacherInput[offset] = (float)((x - currentSample.Position.X) / 500.0);
            _experimentalMlpTeacherInput[offset + 1] = (float)((y - currentSample.Position.Y) / 500.0);
            _experimentalMlpTeacherInput[offset + 2] = (float)(Math.Max(0.0, ageMilliseconds) / 100.0);
            _experimentalMlpTeacherInput[offset + 3] = (float)(dx / 100.0);
            _experimentalMlpTeacherInput[offset + 4] = (float)(dy / 100.0);
            _experimentalMlpTeacherInput[offset + 5] = (float)(velocityX / 5000.0);
            _experimentalMlpTeacherInput[offset + 6] = (float)(velocityY / 5000.0);
            _experimentalMlpTeacherInput[offset + 7] = 1.0f;
            previousX = x;
            previousY = y;
            previousTicks = timestampTicks;
        }

        private void ComputeExperimentalMlpAlphaBetaCorrection(
            CursorPollSample sample,
            double horizonMilliseconds,
            double velocityXPerSecond,
            double velocityYPerSecond,
            double speed,
            double baselineDisplacementX,
            double baselineDisplacementY,
            out double correctionX,
            out double correctionY)
        {
            double oldestX = sample.Position.X;
            double oldestY = sample.Position.Y;
            long oldestTicks = sample.TimestampTicks;
            if (_historyCount > 0)
            {
                int priorCount = Math.Min(_historyCount, ExperimentalMlpPredictionModel.SequenceLength - 1);
                int oldestIndex = PriorHistoryIndex(0, priorCount);
                oldestX = _historyX[oldestIndex];
                oldestY = _historyY[oldestIndex];
                oldestTicks = _historyTimestampTicks[oldestIndex];
            }

            double ageSeconds = Math.Max((sample.TimestampTicks - oldestTicks) / (double)sample.StopwatchFrequency, 0.001);
            double averageVelocityX = -(oldestX - sample.Position.X) / ageSeconds;
            double averageVelocityY = -(oldestY - sample.Position.Y) / ageSeconds;
            double blendedVelocityX = 0.65 * velocityXPerSecond + 0.35 * averageVelocityX;
            double blendedVelocityY = 0.65 * velocityYPerSecond + 0.35 * averageVelocityY;
            double alphaBetaDisplacementX = blendedVelocityX * (horizonMilliseconds / 1000.0);
            double alphaBetaDisplacementY = blendedVelocityY * (horizonMilliseconds / 1000.0);
            double cap = speed >= 2000.0 ? 32.0 : 16.0;
            ClampVector(ref alphaBetaDisplacementX, ref alphaBetaDisplacementY, cap);
            correctionX = alphaBetaDisplacementX - baselineDisplacementX;
            correctionY = alphaBetaDisplacementY - baselineDisplacementY;
        }

        private bool TryEvaluateDistilledMlpPrediction(
            CursorPollSample sample,
            long horizonTicks,
            long refreshPeriodTicks,
            out float displacementX,
            out float displacementY)
        {
            displacementX = 0.0f;
            displacementY = 0.0f;
            if (sample.StopwatchFrequency <= 0 ||
                horizonTicks <= 0 ||
                refreshPeriodTicks <= 0 ||
                _historyCount < DistilledMlpPredictionModel.SequenceLength - 1)
            {
                return false;
            }

            double refreshMilliseconds = refreshPeriodTicks * 1000.0 / sample.StopwatchFrequency;
            if (refreshMilliseconds < DistilledMlpMinimumRefreshMilliseconds ||
                refreshMilliseconds > DistilledMlpMaximumRefreshMilliseconds)
            {
                return false;
            }

            double horizonMilliseconds = horizonTicks * 1000.0 / sample.StopwatchFrequency;
            if (!FillDistilledMlpInputs(sample, horizonMilliseconds))
            {
                return false;
            }

            if (!_distilledMlpPredictionModel.TryEvaluate(
                _distilledMlpScalarInput,
                _distilledMlpSequenceInput,
                out displacementX,
                out displacementY))
            {
                return false;
            }

            double dx = displacementX * _gain;
            double dy = displacementY * _gain;
            ClampVector(ref dx, ref dy, DistilledMlpMaximumPredictionPixels);
            displacementX = (float)dx;
            displacementY = (float)dy;
            return true;
        }

        private bool FillDistilledMlpInputs(CursorPollSample sample, double horizonMilliseconds)
        {
            DistilledMlpVelocity velocity2;
            DistilledMlpVelocity velocity3;
            DistilledMlpVelocity velocity5;
            DistilledMlpVelocity velocity8;
            DistilledMlpVelocity velocity12;
            DistilledMlpPathAnalysis pathAnalysis;
            if (!TryFitDistilledMlpVelocity(sample, 2, out velocity2) ||
                !TryFitDistilledMlpVelocity(sample, 3, out velocity3) ||
                !TryFitDistilledMlpVelocity(sample, 5, out velocity5) ||
                !TryFitDistilledMlpVelocity(sample, 8, out velocity8) ||
                !TryFitDistilledMlpVelocity(sample, 12, out velocity12) ||
                !TryBuildDistilledMlpPathAnalysis(sample, out pathAnalysis))
            {
                return false;
            }

            if (IsDistilledMlpStationary(velocity2, velocity5, velocity12, pathAnalysis))
            {
                return false;
            }

            Array.Clear(_distilledMlpScalarInput, 0, _distilledMlpScalarInput.Length);
            Array.Clear(_distilledMlpSequenceInput, 0, _distilledMlpSequenceInput.Length);

            double baselineX = 0.0;
            double baselineY = 0.0;
            if (velocity12.Speed > DistilledMlpStepBaselineMinimumSpeedPixelsPerSecond &&
                pathAnalysis.Net > 0.0 &&
                pathAnalysis.Efficiency >= DistilledMlpStepBaselineMinimumEfficiency)
            {
                double baselineHorizonSeconds = Math.Max(
                    0.0,
                    horizonMilliseconds + DistilledMlpStepBaselineHorizonOffsetMilliseconds) / 1000.0;
                baselineX = velocity12.XPerSecond * baselineHorizonSeconds;
                baselineY = velocity12.YPerSecond * baselineHorizonSeconds;
                ClampVector(ref baselineX, ref baselineY, DistilledMlpStepBaselineMaximumPredictionPixels);
            }

            _distilledMlpScalarInput[0] = (float)(horizonMilliseconds / 16.67);
            _distilledMlpScalarInput[1] = 1.0f;
            _distilledMlpScalarInput[2] = 0.0f;
            _distilledMlpScalarInput[3] = 1.0f;
            _distilledMlpScalarInput[4] = 0.0f;
            _distilledMlpScalarInput[5] = (float)Math.Min(8.0, velocity2.Speed / 1000.0);
            _distilledMlpScalarInput[6] = (float)Math.Min(8.0, velocity5.Speed / 1000.0);
            _distilledMlpScalarInput[7] = (float)Math.Min(8.0, velocity8.Speed / 1000.0);
            _distilledMlpScalarInput[8] = (float)Math.Min(8.0, velocity12.Speed / 1000.0);
            SetDistilledMlpVelocityDisplacementFeatures(_distilledMlpScalarInput, 9, velocity2, horizonMilliseconds);
            SetDistilledMlpVelocityDisplacementFeatures(_distilledMlpScalarInput, 11, velocity3, horizonMilliseconds);
            SetDistilledMlpVelocityDisplacementFeatures(_distilledMlpScalarInput, 13, velocity5, horizonMilliseconds);
            SetDistilledMlpVelocityDisplacementFeatures(_distilledMlpScalarInput, 15, velocity8, horizonMilliseconds);
            SetDistilledMlpVelocityDisplacementFeatures(_distilledMlpScalarInput, 17, velocity12, horizonMilliseconds);
            _distilledMlpScalarInput[19] = (float)(pathAnalysis.Net / 128.0);
            _distilledMlpScalarInput[20] = (float)(pathAnalysis.Path / 256.0);
            _distilledMlpScalarInput[21] = (float)Clamp01(pathAnalysis.Efficiency);
            _distilledMlpScalarInput[22] = (float)(Math.Min(pathAnalysis.Reversals, 32) / 8.0);
            _distilledMlpScalarInput[23] = (float)(baselineX / 32.0);
            _distilledMlpScalarInput[24] = (float)(baselineY / 32.0);

            FillDistilledMlpSequence(sample, horizonMilliseconds);
            return true;
        }

        private static bool IsDistilledMlpStationary(
            DistilledMlpVelocity velocity2,
            DistilledMlpVelocity velocity5,
            DistilledMlpVelocity velocity12,
            DistilledMlpPathAnalysis pathAnalysis)
        {
            return velocity2.Speed <= DistilledMlpStationaryMaximumSpeedPixelsPerSecond &&
                velocity5.Speed <= DistilledMlpStationaryMaximumSpeedPixelsPerSecond &&
                velocity12.Speed <= DistilledMlpStationaryMaximumSpeedPixelsPerSecond &&
                pathAnalysis.Net <= DistilledMlpStationaryMaximumNetPixels &&
                pathAnalysis.Path <= DistilledMlpStationaryMaximumPathPixels;
        }

        private static void SetDistilledMlpVelocityDisplacementFeatures(
            float[] scalar,
            int offset,
            DistilledMlpVelocity velocity,
            double horizonMilliseconds)
        {
            double horizonSeconds = horizonMilliseconds / 1000.0;
            scalar[offset] = (float)(velocity.XPerSecond * horizonSeconds / 32.0);
            scalar[offset + 1] = (float)(velocity.YPerSecond * horizonSeconds / 32.0);
        }

        private bool TryFitDistilledMlpVelocity(CursorPollSample sample, int sampleCount, out DistilledMlpVelocity velocity)
        {
            velocity = new DistilledMlpVelocity();
            if (sampleCount < 2 || _historyCount + 1 < sampleCount || sample.StopwatchFrequency <= 0)
            {
                return false;
            }

            double sumT = 0.0;
            double sumX = 0.0;
            double sumY = 0.0;
            for (int i = 0; i < sampleCount; i++)
            {
                double x;
                double y;
                long ticks;
                if (!TryResolveDistilledMlpPoint(sample, i, sampleCount, out x, out y, out ticks))
                {
                    return false;
                }

                double t = (ticks - sample.TimestampTicks) / (double)sample.StopwatchFrequency;
                sumT += t;
                sumX += x;
                sumY += y;
            }

            double meanT = sumT / sampleCount;
            double meanX = sumX / sampleCount;
            double meanY = sumY / sampleCount;
            double denominator = 0.0;
            double numeratorX = 0.0;
            double numeratorY = 0.0;
            for (int i = 0; i < sampleCount; i++)
            {
                double x;
                double y;
                long ticks;
                if (!TryResolveDistilledMlpPoint(sample, i, sampleCount, out x, out y, out ticks))
                {
                    return false;
                }

                double centeredT = ((ticks - sample.TimestampTicks) / (double)sample.StopwatchFrequency) - meanT;
                denominator += centeredT * centeredT;
                numeratorX += centeredT * (x - meanX);
                numeratorY += centeredT * (y - meanY);
            }

            if (denominator <= 0.0)
            {
                return false;
            }

            velocity.XPerSecond = numeratorX / denominator;
            velocity.YPerSecond = numeratorY / denominator;
            velocity.Speed = Magnitude(velocity.XPerSecond, velocity.YPerSecond);
            return true;
        }

        private bool TryBuildDistilledMlpPathAnalysis(CursorPollSample sample, out DistilledMlpPathAnalysis analysis)
        {
            analysis = new DistilledMlpPathAnalysis();
            int sampleCount = Math.Min(12, _historyCount + 1);
            if (sampleCount < 2)
            {
                return false;
            }

            double firstX = 0.0;
            double firstY = 0.0;
            double previousX = 0.0;
            double previousY = 0.0;
            int previousSignX = 0;
            int previousSignY = 0;
            for (int i = 0; i < sampleCount; i++)
            {
                double x;
                double y;
                long ticks;
                if (!TryResolveDistilledMlpPoint(sample, i, sampleCount, out x, out y, out ticks))
                {
                    return false;
                }

                if (i == 0)
                {
                    firstX = x;
                    firstY = y;
                    previousX = x;
                    previousY = y;
                    continue;
                }

                AccumulateDistilledMlpPathStep(
                    previousX,
                    previousY,
                    x,
                    y,
                    ref analysis.Path,
                    ref previousSignX,
                    ref previousSignY,
                    ref analysis.Reversals);
                previousX = x;
                previousY = y;
            }

            analysis.Net = Magnitude(sample.Position.X - firstX, sample.Position.Y - firstY);
            analysis.Efficiency = analysis.Path > 0.0 ? analysis.Net / analysis.Path : 0.0;
            return true;
        }

        private void FillDistilledMlpSequence(CursorPollSample sample, double horizonMilliseconds)
        {
            int priorCount = DistilledMlpPredictionModel.SequenceLength - 1;
            double previousX;
            double previousY;
            long previousTicks;
            if (_historyCount > priorCount)
            {
                int previousIndex = PriorHistoryIndex(0, priorCount + 1);
                previousX = _historyX[previousIndex];
                previousY = _historyY[previousIndex];
                previousTicks = _historyTimestampTicks[previousIndex];
            }
            else
            {
                int firstIndex = PriorHistoryIndex(0, priorCount);
                previousX = _historyX[firstIndex];
                previousY = _historyY[firstIndex];
                previousTicks = _historyTimestampTicks[firstIndex];
            }

            for (int i = 0; i < priorCount; i++)
            {
                int index = PriorHistoryIndex(i, priorCount);
                FillDistilledMlpSequenceRow(
                    i,
                    _historyX[index],
                    _historyY[index],
                    _historyTimestampTicks[index],
                    sample,
                    horizonMilliseconds,
                    ref previousX,
                    ref previousY,
                    ref previousTicks);
            }

            FillDistilledMlpSequenceRow(
                priorCount,
                sample.Position.X,
                sample.Position.Y,
                sample.TimestampTicks,
                sample,
                horizonMilliseconds,
                ref previousX,
                ref previousY,
                ref previousTicks);
        }

        private void FillDistilledMlpSequenceRow(
            int row,
            double x,
            double y,
            long timestampTicks,
            CursorPollSample currentSample,
            double horizonMilliseconds,
            ref double previousX,
            ref double previousY,
            ref long previousTicks)
        {
            double dtMilliseconds = Math.Max(0.0, (timestampTicks - previousTicks) * 1000.0 / currentSample.StopwatchFrequency);
            double dx = x - previousX;
            double dy = y - previousY;
            double velocityX = dtMilliseconds > 0.0 ? dx / (dtMilliseconds / 1000.0) : 0.0;
            double velocityY = dtMilliseconds > 0.0 ? dy / (dtMilliseconds / 1000.0) : 0.0;
            double ageMilliseconds = Math.Max(0.0, (currentSample.TimestampTicks - timestampTicks) * 1000.0 / currentSample.StopwatchFrequency);
            double horizonSeconds = horizonMilliseconds / 1000.0;
            int offset = row * DistilledMlpPredictionModel.SequenceFeatureCount;
            _distilledMlpSequenceInput[offset] = 1.0f;
            _distilledMlpSequenceInput[offset + 1] = (float)(ageMilliseconds / 64.0);
            _distilledMlpSequenceInput[offset + 2] = (float)((x - currentSample.Position.X) / 128.0);
            _distilledMlpSequenceInput[offset + 3] = (float)((y - currentSample.Position.Y) / 128.0);
            _distilledMlpSequenceInput[offset + 4] = (float)(dx / 32.0);
            _distilledMlpSequenceInput[offset + 5] = (float)(dy / 32.0);
            _distilledMlpSequenceInput[offset + 6] = (float)(velocityX * horizonSeconds / 32.0);
            _distilledMlpSequenceInput[offset + 7] = (float)(velocityY * horizonSeconds / 32.0);
            _distilledMlpSequenceInput[offset + 8] = (float)(dtMilliseconds / 16.0);
            previousX = x;
            previousY = y;
            previousTicks = timestampTicks;
        }

        private bool TryResolveDistilledMlpPoint(
            CursorPollSample sample,
            int offsetFromOldest,
            int sampleCount,
            out double x,
            out double y,
            out long timestampTicks)
        {
            if (offsetFromOldest == sampleCount - 1)
            {
                x = sample.Position.X;
                y = sample.Position.Y;
                timestampTicks = sample.TimestampTicks;
                return true;
            }

            int priorCount = sampleCount - 1;
            if (offsetFromOldest < 0 || priorCount <= 0 || _historyCount < priorCount)
            {
                x = 0.0;
                y = 0.0;
                timestampTicks = 0;
                return false;
            }

            int index = PriorHistoryIndex(offsetFromOldest, priorCount);
            x = _historyX[index];
            y = _historyY[index];
            timestampTicks = _historyTimestampTicks[index];
            return true;
        }

        private static void AccumulateDistilledMlpPathStep(
            double previousX,
            double previousY,
            double currentX,
            double currentY,
            ref double path,
            ref int previousSignX,
            ref int previousSignY,
            ref int reversals)
        {
            double dx = currentX - previousX;
            double dy = currentY - previousY;
            path += Magnitude(dx, dy);
            AccumulateDistilledMlpSign(dx, ref previousSignX, ref reversals);
            AccumulateDistilledMlpSign(dy, ref previousSignY, ref reversals);
        }

        private static void AccumulateDistilledMlpSign(double delta, ref int previousSign, ref int reversals)
        {
            if (Math.Abs(delta) <= 0.5)
            {
                return;
            }

            int sign = delta > 0.0 ? 1 : -1;
            if (previousSign != 0 && sign != previousSign)
            {
                reversals++;
            }

            previousSign = sign;
        }

        private static double Clamp01(double value)
        {
            return Math.Max(0.0, Math.Min(1.0, value));
        }

        private bool TryPredictLeastSquares(CursorPollSample sample, long horizonTicks, out PointF predicted)
        {
            predicted = new PointF(sample.Position.X, sample.Position.Y);
            if (sample.StopwatchFrequency <= 0 || horizonTicks <= 0)
            {
                return false;
            }

            if (ShouldResetLeastSquaresHistory(sample))
            {
                ResetLeastSquaresHistory(sample);
                return false;
            }

            if (_leastSquaresFreshSampleCount + 1 < LeastSquaresFreshSampleRequirement)
            {
                return false;
            }

            PathAnalysis fitPath;
            if (!TryAnalyzeTimedPath(sample, LeastSquaresWindowMilliseconds, out fitPath) ||
                fitPath.SampleCount < LeastSquaresMinimumSamples ||
                fitPath.EfficiencyPercent < LeastSquaresMinimumEfficiencyPercent)
            {
                return false;
            }

            PathAnalysis jitterPath;
            if (TryAnalyzeTimedPath(sample, LeastSquaresJitterWindowMilliseconds, out jitterPath) &&
                jitterPath.Reversals >= LeastSquaresJitterMinimumReversals &&
                jitterPath.Span <= LeastSquaresJitterMaximumSpanPixels &&
                jitterPath.EfficiencyPercent <= LeastSquaresJitterMaximumEfficiencyPercent)
            {
                return false;
            }

            double velocityXPerSecond;
            double velocityYPerSecond;
            if (!TryFitLeastSquaresVelocity(sample, LeastSquaresWindowMilliseconds, out velocityXPerSecond, out velocityYPerSecond))
            {
                return false;
            }

            double speed = Magnitude(velocityXPerSecond, velocityYPerSecond);
            long effectiveHorizonTicks = ApplyLeastSquaresHorizonGuard(sample, horizonTicks, speed, fitPath.Net);
            if (effectiveHorizonTicks <= 0)
            {
                return false;
            }

            double horizonSeconds = effectiveHorizonTicks / (double)sample.StopwatchFrequency;
            double dx = velocityXPerSecond * horizonSeconds * _gain;
            double dy = velocityYPerSecond * horizonSeconds * _gain;
            double maxPrediction = Math.Min(LeastSquaresMaximumPredictionPixels, fitPath.Net * LeastSquaresNetDisplacementScale);
            if (maxPrediction <= 0)
            {
                return false;
            }

            ClampVector(ref dx, ref dy, maxPrediction);
            predicted = new PointF((float)(sample.Position.X + dx), (float)(sample.Position.Y + dy));
            return true;
        }

        private bool ShouldResetLeastSquaresHistory(CursorPollSample sample)
        {
            if (!_hasSample || sample.StopwatchFrequency <= 0)
            {
                return false;
            }

            long deltaTicks = sample.TimestampTicks - _lastTimestampTicks;
            if (deltaTicks <= 0)
            {
                return true;
            }

            double deltaMilliseconds = deltaTicks * 1000.0 / sample.StopwatchFrequency;
            double dx = sample.Position.X - _lastX;
            double dy = sample.Position.Y - _lastY;
            double displacement = Magnitude(dx, dy);
            double speed = displacement / (deltaTicks / (double)sample.StopwatchFrequency);
            return deltaMilliseconds > LeastSquaresResetGapMilliseconds ||
                speed > LeastSquaresResetSpeedPixelsPerSecond ||
                displacement > LeastSquaresResetDisplacementPixels;
        }

        private void ResetLeastSquaresHistory(CursorPollSample sample)
        {
            _historyCount = 0;
            _historyNextIndex = 0;
            _leastSquaresFreshSampleCount = 0;
            _oscillationLatchUntilTicks = 0;
            _leastSquaresLowHorizonUntilTicks = sample.TimestampTicks + MillisecondsToTicks(LeastSquaresResetLowHorizonDurationMilliseconds, sample.StopwatchFrequency);
        }

        private long ApplyLeastSquaresHorizonGuard(CursorPollSample sample, long horizonTicks, double speed, double net)
        {
            long guardedHorizonTicks = horizonTicks;
            if (sample.TimestampTicks < _leastSquaresLowHorizonUntilTicks ||
                speed < LeastSquaresLowSpeedHorizonPixelsPerSecond ||
                net < LeastSquaresLowNetHorizonPixels)
            {
                long lowHorizonTicks = MillisecondsToTicks(LeastSquaresResetLowHorizonMilliseconds, sample.StopwatchFrequency);
                if (lowHorizonTicks > 0)
                {
                    guardedHorizonTicks = Math.Min(guardedHorizonTicks, lowHorizonTicks);
                }
            }

            return guardedHorizonTicks;
        }

        private bool TryFitLeastSquaresVelocity(
            CursorPollSample sample,
            int windowMilliseconds,
            out double velocityXPerSecond,
            out double velocityYPerSecond)
        {
            velocityXPerSecond = 0;
            velocityYPerSecond = 0;
            long windowTicks = MillisecondsToTicks(windowMilliseconds, sample.StopwatchFrequency);
            if (windowTicks <= 0)
            {
                return false;
            }

            long minimumTicks = sample.TimestampTicks - windowTicks;
            int count = 0;
            double sumT = 0;
            double sumX = 0;
            double sumY = 0;
            AccumulateLeastSquaresSample(sample.TimestampTicks, sample.Position.X, sample.Position.Y, sample, ref count, ref sumT, ref sumX, ref sumY);
            int historyCount = _historyCount;
            for (int i = 0; i < historyCount; i++)
            {
                int index = PriorHistoryIndex(i, historyCount);
                if (_historyTimestampTicks[index] >= minimumTicks && _historyTimestampTicks[index] <= sample.TimestampTicks)
                {
                    AccumulateLeastSquaresSample(
                        _historyTimestampTicks[index],
                        _historyX[index],
                        _historyY[index],
                        sample,
                        ref count,
                        ref sumT,
                        ref sumX,
                        ref sumY);
                }
            }

            if (count < LeastSquaresMinimumSamples)
            {
                return false;
            }

            double meanT = sumT / count;
            double meanX = sumX / count;
            double meanY = sumY / count;
            double denominator = 0;
            double numeratorX = 0;
            double numeratorY = 0;
            AccumulateLeastSquaresFit(sample.TimestampTicks, sample.Position.X, sample.Position.Y, sample, meanT, meanX, meanY, ref denominator, ref numeratorX, ref numeratorY);
            for (int i = 0; i < historyCount; i++)
            {
                int index = PriorHistoryIndex(i, historyCount);
                if (_historyTimestampTicks[index] >= minimumTicks && _historyTimestampTicks[index] <= sample.TimestampTicks)
                {
                    AccumulateLeastSquaresFit(
                        _historyTimestampTicks[index],
                        _historyX[index],
                        _historyY[index],
                        sample,
                        meanT,
                        meanX,
                        meanY,
                        ref denominator,
                        ref numeratorX,
                        ref numeratorY);
                }
            }

            if (denominator <= 0)
            {
                return false;
            }

            velocityXPerSecond = numeratorX / denominator;
            velocityYPerSecond = numeratorY / denominator;
            return true;
        }

        private static void AccumulateLeastSquaresSample(
            long timestampTicks,
            double x,
            double y,
            CursorPollSample currentSample,
            ref int count,
            ref double sumT,
            ref double sumX,
            ref double sumY)
        {
            double t = (timestampTicks - currentSample.TimestampTicks) / (double)currentSample.StopwatchFrequency;
            count++;
            sumT += t;
            sumX += x;
            sumY += y;
        }

        private static void AccumulateLeastSquaresFit(
            long timestampTicks,
            double x,
            double y,
            CursorPollSample currentSample,
            double meanT,
            double meanX,
            double meanY,
            ref double denominator,
            ref double numeratorX,
            ref double numeratorY)
        {
            double centeredT = ((timestampTicks - currentSample.TimestampTicks) / (double)currentSample.StopwatchFrequency) - meanT;
            denominator += centeredT * centeredT;
            numeratorX += centeredT * (x - meanX);
            numeratorY += centeredT * (y - meanY);
        }

        private double SelectGain(CursorPollSample sample, double velocityXPerSecond, double velocityYPerSecond, double deltaSeconds)
        {
            if (!_adaptiveGainEnabled || !_hasVelocity || deltaSeconds <= 0)
            {
                return _gain;
            }

            double speed = Magnitude(velocityXPerSecond, velocityYPerSecond);
            if (speed <= 0)
            {
                _stableDirectionSampleCount = 0;
                return _gain;
            }

            double previousSpeed = Magnitude(_lastVelocityXPerSecond, _lastVelocityYPerSecond);
            if (previousSpeed <= 0)
            {
                _stableDirectionSampleCount = 0;
                return _gain;
            }

            double dot = (velocityXPerSecond * _lastVelocityXPerSecond) + (velocityYPerSecond * _lastVelocityYPerSecond);
            double directionAgreement = dot / (speed * previousSpeed);
            if (directionAgreement < 0)
            {
                _samplesSinceDirectionReversal = 0;
            }
            else if (_samplesSinceDirectionReversal < int.MaxValue)
            {
                _samplesSinceDirectionReversal++;
            }

            if (directionAgreement >= 0.90)
            {
                _stableDirectionSampleCount++;
            }
            else
            {
                _stableDirectionSampleCount = 0;
            }

            if (ShouldUseAdaptiveGainForFastLinearMotion(sample, speed))
            {
                return _adaptiveGain;
            }

            if (ShouldSuppressAdaptiveGainForOscillation(sample))
            {
                return _gain;
            }

            if (_adaptiveReversalCooldownSamples > 0 && _samplesSinceDirectionReversal < _adaptiveReversalCooldownSamples)
            {
                return _gain;
            }

            if (_stableDirectionSampleCount < _adaptiveStableDirectionSamples)
            {
                return _gain;
            }

            if (speed < _adaptiveMinimumSpeedPixelsPerSecond)
            {
                return _gain;
            }

            if (directionAgreement < 0.90)
            {
                return _gain;
            }

            double acceleration = Magnitude(
                velocityXPerSecond - _lastVelocityXPerSecond,
                velocityYPerSecond - _lastVelocityYPerSecond) / deltaSeconds;
            if (acceleration > _adaptiveMaximumAccelerationPixelsPerSecondSquared)
            {
                return _gain;
            }

            return _adaptiveGain;
        }

        private bool ShouldUseAdaptiveGainForFastLinearMotion(CursorPollSample sample, double speed)
        {
            if (_adaptiveOscillationWindowSamples <= 0 ||
                speed < FastLinearOverrideMinimumSpeedPixelsPerSecond ||
                _stableDirectionSampleCount < FastLinearOverrideStableDirectionSamples)
            {
                return false;
            }

            double span;
            double path;
            double net;
            int reversals;
            double efficiencyPercent;
            int priorCount = Math.Min(_historyCount, FastLinearOverrideWindowSamples - 1);
            if (!TryAnalyzeRecentPath(sample, priorCount, out span, out path, out net, out reversals, out efficiencyPercent))
            {
                return false;
            }

            return reversals == 0 &&
                efficiencyPercent >= FastLinearOverrideMinimumEfficiencyPercent &&
                net >= FastLinearOverrideMinimumNetPixels;
        }

        private bool ShouldSuppressAdaptiveGainForOscillation(CursorPollSample sample)
        {
            if (_adaptiveOscillationLatchMilliseconds > 0 && sample.TimestampTicks < _oscillationLatchUntilTicks)
            {
                return true;
            }

            if (_adaptiveOscillationWindowSamples < 4 || _historyCount < 3)
            {
                return false;
            }

            int priorCount = Math.Min(_historyCount, _adaptiveOscillationWindowSamples - 1);
            double span;
            double path = 0;
            double net;
            int reversals = 0;
            double efficiencyPercent;
            if (!TryAnalyzeRecentPath(sample, priorCount, out span, out path, out net, out reversals, out efficiencyPercent))
            {
                return false;
            }

            if (span > _adaptiveOscillationMaximumSpanPixels ||
                reversals < _adaptiveOscillationMinimumReversals ||
                efficiencyPercent > _adaptiveOscillationMaximumEfficiencyPercent)
            {
                return false;
            }

            if (_adaptiveOscillationLatchMilliseconds > 0 && sample.StopwatchFrequency > 0)
            {
                _oscillationLatchUntilTicks = sample.TimestampTicks + (long)Math.Round(_adaptiveOscillationLatchMilliseconds * sample.StopwatchFrequency / 1000.0);
            }

            return true;
        }

        private bool TryAnalyzeRecentPath(
            CursorPollSample sample,
            int priorCount,
            out double span,
            out double path,
            out double net,
            out int reversals,
            out double efficiencyPercent)
        {
            span = 0;
            path = 0;
            net = 0;
            reversals = 0;
            efficiencyPercent = 0;
            if (priorCount < 3)
            {
                return false;
            }

            double minX = sample.Position.X;
            double maxX = sample.Position.X;
            double minY = sample.Position.Y;
            double maxY = sample.Position.Y;
            for (int i = 0; i < priorCount; i++)
            {
                int index = PriorHistoryIndex(i, priorCount);
                minX = Math.Min(minX, _historyX[index]);
                maxX = Math.Max(maxX, _historyX[index]);
                minY = Math.Min(minY, _historyY[index]);
                maxY = Math.Max(maxY, _historyY[index]);
            }

            bool useX = (maxX - minX) >= (maxY - minY);
            span = useX ? maxX - minX : maxY - minY;
            double previous = useX ? _historyX[PriorHistoryIndex(0, priorCount)] : _historyY[PriorHistoryIndex(0, priorCount)];
            double first = previous;
            int previousSign = 0;
            for (int i = 1; i < priorCount; i++)
            {
                int index = PriorHistoryIndex(i, priorCount);
                double value = useX ? _historyX[index] : _historyY[index];
                AccumulateOscillationStep(previous, value, ref path, ref previousSign, ref reversals);
                previous = value;
            }

            double current = useX ? sample.Position.X : sample.Position.Y;
            AccumulateOscillationStep(previous, current, ref path, ref previousSign, ref reversals);
            if (path <= 0)
            {
                return false;
            }

            net = Math.Abs(current - first);
            efficiencyPercent = net / path * 100.0;
            return true;
        }

        private bool ShouldUseHighSpeedConstantVelocityCap(CursorPollSample sample, double velocityXPerSecond, double velocityYPerSecond)
        {
            double speed = Magnitude(velocityXPerSecond, velocityYPerSecond);
            if (speed < ConstantVelocityHighSpeedMinimumPixelsPerSecond || _historyCount < 3)
            {
                return false;
            }

            double span;
            double path;
            double net;
            int reversals;
            double efficiencyPercent;
            int priorCount = Math.Min(_historyCount, ConstantVelocityHighSpeedWindowSamples - 1);
            if (!TryAnalyzeRecentPath(sample, priorCount, out span, out path, out net, out reversals, out efficiencyPercent))
            {
                return false;
            }

            return reversals == 0 &&
                efficiencyPercent >= ConstantVelocityHighSpeedMinimumEfficiencyPercent &&
                net >= ConstantVelocityHighSpeedMinimumNetPixels;
        }

        private bool TryAnalyzeTimedPath(CursorPollSample sample, int windowMilliseconds, out PathAnalysis analysis)
        {
            analysis = new PathAnalysis();
            long windowTicks = MillisecondsToTicks(windowMilliseconds, sample.StopwatchFrequency);
            if (windowTicks <= 0 || _historyCount < 1)
            {
                return false;
            }

            long minimumTicks = sample.TimestampTicks - windowTicks;
            double minX = sample.Position.X;
            double maxX = sample.Position.X;
            double minY = sample.Position.Y;
            double maxY = sample.Position.Y;
            int selectedPriorCount = 0;
            int historyCount = _historyCount;
            for (int i = 0; i < historyCount; i++)
            {
                int index = PriorHistoryIndex(i, historyCount);
                if (_historyTimestampTicks[index] >= minimumTicks && _historyTimestampTicks[index] <= sample.TimestampTicks)
                {
                    selectedPriorCount++;
                    minX = Math.Min(minX, _historyX[index]);
                    maxX = Math.Max(maxX, _historyX[index]);
                    minY = Math.Min(minY, _historyY[index]);
                    maxY = Math.Max(maxY, _historyY[index]);
                }
            }

            if (selectedPriorCount < 1)
            {
                return false;
            }

            bool useX = (maxX - minX) >= (maxY - minY);
            analysis.Span = useX ? maxX - minX : maxY - minY;
            bool hasPrevious = false;
            double previous = 0;
            double first = 0;
            int previousSign = 0;
            for (int i = 0; i < historyCount; i++)
            {
                int index = PriorHistoryIndex(i, historyCount);
                if (_historyTimestampTicks[index] < minimumTicks || _historyTimestampTicks[index] > sample.TimestampTicks)
                {
                    continue;
                }

                double value = useX ? _historyX[index] : _historyY[index];
                if (!hasPrevious)
                {
                    hasPrevious = true;
                    first = value;
                    previous = value;
                }
                else
                {
                    AccumulateOscillationStep(previous, value, ref analysis.Path, ref previousSign, ref analysis.Reversals);
                    previous = value;
                }

                analysis.SampleCount++;
            }

            if (!hasPrevious)
            {
                return false;
            }

            double current = useX ? sample.Position.X : sample.Position.Y;
            AccumulateOscillationStep(previous, current, ref analysis.Path, ref previousSign, ref analysis.Reversals);
            analysis.SampleCount++;
            if (analysis.Path <= 0)
            {
                return false;
            }

            analysis.Net = Math.Abs(current - first);
            analysis.EfficiencyPercent = analysis.Net / analysis.Path * 100.0;
            return true;
        }

        private bool TryAnalyzeExperimentalMlpPath(CursorPollSample sample, out ExperimentalMlpPathAnalysis analysis)
        {
            analysis = new ExperimentalMlpPathAnalysis();
            if (sample.StopwatchFrequency <= 0 || _historyCount < 1)
            {
                return false;
            }

            long windowTicks = (long)Math.Round(ExperimentalMlpPathWindowMilliseconds * sample.StopwatchFrequency / 1000.0);
            if (windowTicks <= 0)
            {
                return false;
            }

            long minimumTicks = sample.TimestampTicks - windowTicks;
            bool hasPrevious = false;
            double firstX = 0.0;
            double firstY = 0.0;
            double previousX = 0.0;
            double previousY = 0.0;
            int previousSignX = 0;
            int previousSignY = 0;
            int selected = 0;
            int historyCount = _historyCount;
            for (int i = 0; i < historyCount; i++)
            {
                int index = PriorHistoryIndex(i, historyCount);
                if (_historyTimestampTicks[index] < minimumTicks || _historyTimestampTicks[index] > sample.TimestampTicks)
                {
                    continue;
                }

                double x = _historyX[index];
                double y = _historyY[index];
                if (!hasPrevious)
                {
                    firstX = x;
                    firstY = y;
                    previousX = x;
                    previousY = y;
                    hasPrevious = true;
                }
                else
                {
                    AccumulateExperimentalMlpPathStep(
                        previousX,
                        previousY,
                        x,
                        y,
                        ref analysis.Path,
                        ref previousSignX,
                        ref previousSignY,
                        ref analysis.Reversals);
                    previousX = x;
                    previousY = y;
                }

                selected++;
            }

            if (!hasPrevious || selected < 1)
            {
                return false;
            }

            AccumulateExperimentalMlpPathStep(
                previousX,
                previousY,
                sample.Position.X,
                sample.Position.Y,
                ref analysis.Path,
                ref previousSignX,
                ref previousSignY,
                ref analysis.Reversals);
            if (analysis.Path <= 0)
            {
                return false;
            }

            analysis.Net = Magnitude(sample.Position.X - firstX, sample.Position.Y - firstY);
            analysis.Efficiency = analysis.Net / analysis.Path;
            return true;
        }

        private static void AccumulateExperimentalMlpPathStep(
            double previousX,
            double previousY,
            double currentX,
            double currentY,
            ref double path,
            ref int previousSignX,
            ref int previousSignY,
            ref int reversals)
        {
            double dx = currentX - previousX;
            double dy = currentY - previousY;
            path += Magnitude(dx, dy);
            AccumulateExperimentalMlpSign(dx, ref previousSignX, ref reversals);
            AccumulateExperimentalMlpSign(dy, ref previousSignY, ref reversals);
        }

        private static void AccumulateExperimentalMlpSign(double delta, ref int previousSign, ref int reversals)
        {
            int sign = delta > 0.0 ? 1 : delta < 0.0 ? -1 : 0;
            if (sign == 0)
            {
                return;
            }

            if (previousSign != 0 && sign != previousSign)
            {
                reversals++;
            }

            previousSign = sign;
        }

        private static long MillisecondsToTicks(int milliseconds, long stopwatchFrequency)
        {
            if (milliseconds <= 0 || stopwatchFrequency <= 0)
            {
                return 0;
            }

            return (long)Math.Round(milliseconds * stopwatchFrequency / 1000.0);
        }

        private static void ClampVector(ref double x, ref double y, double maximumMagnitude)
        {
            double magnitude = Magnitude(x, y);
            if (magnitude <= maximumMagnitude || magnitude <= 0)
            {
                return;
            }

            double scale = maximumMagnitude / magnitude;
            x *= scale;
            y *= scale;
        }

        private struct PathAnalysis
        {
            public int SampleCount;
            public double Span;
            public double Path;
            public double Net;
            public int Reversals;
            public double EfficiencyPercent;
        }

        private struct ExperimentalMlpPathAnalysis
        {
            public double Path;
            public double Net;
            public int Reversals;
            public double Efficiency;
        }

        private struct DistilledMlpVelocity
        {
            public double XPerSecond;
            public double YPerSecond;
            public double Speed;
        }

        private struct DistilledMlpPathAnalysis
        {
            public double Path;
            public double Net;
            public int Reversals;
            public double Efficiency;
        }

        private int PriorHistoryIndex(int offsetFromOldest, int priorCount)
        {
            return (_historyNextIndex - priorCount + offsetFromOldest + _historyX.Length) % _historyX.Length;
        }

        private static void AccumulateOscillationStep(double previous, double current, ref double path, ref int previousSign, ref int reversals)
        {
            double delta = current - previous;
            double distance = Math.Abs(delta);
            if (distance < 0.5)
            {
                return;
            }

            path += distance;
            int sign = delta > 0 ? 1 : -1;
            if (previousSign != 0 && sign != previousSign)
            {
                reversals++;
            }

            previousSign = sign;
        }

        private static double Magnitude(double x, double y)
        {
            return Math.Sqrt((x * x) + (y * y));
        }

        private long ApplyHorizonCap(long horizonTicks, long stopwatchFrequency)
        {
            if (_horizonCapMilliseconds <= 0 || stopwatchFrequency <= 0)
            {
                return horizonTicks;
            }

            long capTicks = (long)Math.Round((_horizonCapMilliseconds * stopwatchFrequency) / 1000.0);
            if (capTicks <= 0)
            {
                return horizonTicks;
            }

            return Math.Min(horizonTicks, capTicks);
        }

        private long ApplyLeastSquaresDefaultHorizonCap(long horizonTicks, long stopwatchFrequency)
        {
            if (_horizonCapMilliseconds > 0 || stopwatchFrequency <= 0)
            {
                return horizonTicks;
            }

            long capTicks = MillisecondsToTicks(LeastSquaresDefaultHorizonCapMilliseconds, stopwatchFrequency);
            if (capTicks <= 0)
            {
                return horizonTicks;
            }

            return Math.Min(horizonTicks, capTicks);
        }

        private long ApplyTargetOffset(long targetTicks, long stopwatchFrequency)
        {
            if (targetTicks <= 0 || stopwatchFrequency <= 0 || _targetOffsetMilliseconds == 0)
            {
                return targetTicks;
            }

            long offsetTicks = (long)Math.Round(_targetOffsetMilliseconds * stopwatchFrequency / 1000.0);
            if (offsetTicks > 0 && targetTicks > long.MaxValue - offsetTicks)
            {
                return long.MaxValue;
            }

            if (offsetTicks < 0 && targetTicks < long.MinValue - offsetTicks)
            {
                return long.MinValue;
            }

            return targetTicks + offsetTicks;
        }

        private bool IsIdleGap(long deltaTicks, long stopwatchFrequency)
        {
            if (stopwatchFrequency <= 0)
            {
                return true;
            }

            double deltaMilliseconds = (deltaTicks * 1000.0) / stopwatchFrequency;
            return deltaMilliseconds > _idleResetMilliseconds;
        }

        private static long SelectNextVBlank(CursorPollSample sample, CursorPredictionCounters counters)
        {
            if (!sample.DwmTimingAvailable || sample.DwmVBlankTicks <= 0 || sample.DwmRefreshPeriodTicks <= 0)
            {
                counters.InvalidDwmHorizon++;
                return 0;
            }

            long next = sample.DwmVBlankTicks;
            if (next <= sample.TimestampTicks)
            {
                counters.LateDwmHorizon++;
                long periodsLate = ((sample.TimestampTicks - next) / sample.DwmRefreshPeriodTicks) + 1L;
                next += periodsLate * sample.DwmRefreshPeriodTicks;
            }

            return next;
        }

        private static long SelectPredictionTargetVBlank(CursorPollSample sample, CursorPredictionCounters counters, long targetVBlankTicks, long refreshPeriodTicks)
        {
            if (targetVBlankTicks <= 0)
            {
                return SelectNextVBlank(sample, counters);
            }

            long effectiveRefreshPeriodTicks = ResolveRefreshPeriodTicks(sample, refreshPeriodTicks);
            if (effectiveRefreshPeriodTicks <= 0)
            {
                counters.InvalidDwmHorizon++;
                return 0;
            }

            counters.ScheduledDwmTargetUsed++;
            long target = targetVBlankTicks;
            if (target <= sample.TimestampTicks)
            {
                counters.LateDwmHorizon++;
                long periodsLate = ((sample.TimestampTicks - target) / effectiveRefreshPeriodTicks) + 1L;
                target += periodsLate * effectiveRefreshPeriodTicks;
            }

            return target;
        }

        private static long ResolveRefreshPeriodTicks(CursorPollSample sample, long refreshPeriodTicks)
        {
            if (refreshPeriodTicks > 0)
            {
                return refreshPeriodTicks;
            }

            return sample.DwmRefreshPeriodTicks;
        }

        private void StoreSample(CursorPollSample sample)
        {
            _lastX = sample.Position.X;
            _lastY = sample.Position.Y;
            _lastTimestampTicks = sample.TimestampTicks;
            _hasSample = true;
            _hasVelocity = false;
            _samplesSinceDirectionReversal = int.MaxValue;
            _stableDirectionSampleCount = 0;
            AddHistory(sample);
        }

        private void StoreSample(CursorPollSample sample, double velocityXPerSecond, double velocityYPerSecond)
        {
            _lastX = sample.Position.X;
            _lastY = sample.Position.Y;
            _lastTimestampTicks = sample.TimestampTicks;
            _hasSample = true;
            _hasVelocity = true;
            _lastVelocityXPerSecond = velocityXPerSecond;
            _lastVelocityYPerSecond = velocityYPerSecond;
            AddHistory(sample);
        }

        private void AddHistory(CursorPollSample sample)
        {
            _historyX[_historyNextIndex] = sample.Position.X;
            _historyY[_historyNextIndex] = sample.Position.Y;
            _historyTimestampTicks[_historyNextIndex] = sample.TimestampTicks;
            _historyNextIndex = (_historyNextIndex + 1) % _historyX.Length;
            if (_historyCount < _historyX.Length)
            {
                _historyCount++;
            }

            if (_leastSquaresFreshSampleCount < int.MaxValue)
            {
                _leastSquaresFreshSampleCount++;
            }
        }
    }
}
