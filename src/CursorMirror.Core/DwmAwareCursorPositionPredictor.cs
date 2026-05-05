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
        private readonly double[] _historyX = new double[HistoryCapacity + 1];
        private readonly double[] _historyY = new double[HistoryCapacity + 1];
        private readonly long[] _historyTimestampTicks = new long[HistoryCapacity + 1];
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
        private int _targetOffsetMilliseconds;
        private int _historyCount;
        private int _historyNextIndex;
        private long _oscillationLatchUntilTicks;

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
            ApplyPredictionTargetOffsetMilliseconds(CursorMirrorSettings.DefaultDwmPredictionTargetOffsetMilliseconds);
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
            CursorMirrorSettings.NormalizeDwmPredictionModel(predictionModel);
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
            double effectiveGain = SelectGain(sample, velocityXPerSecond, velocityYPerSecond, deltaSeconds);
            bool useHighSpeedLinearCap = ShouldUseHighSpeedConstantVelocityCap(sample, velocityXPerSecond, velocityYPerSecond);
            double scale = effectiveGain * horizonTicks / deltaTicks;
            double dxConstantVelocity = (sample.Position.X - _lastX) * scale;
            double dyConstantVelocity = (sample.Position.Y - _lastY) * scale;
            double maximumPredictionPixels = useHighSpeedLinearCap ? ConstantVelocityHighSpeedMaximumPredictionPixels : ConstantVelocityMaximumPredictionPixels;
            ClampVector(ref dxConstantVelocity, ref dyConstantVelocity, maximumPredictionPixels);
            double predictedX = sample.Position.X + dxConstantVelocity;
            double predictedY = sample.Position.Y + dyConstantVelocity;
            StoreSample(sample, velocityXPerSecond, velocityYPerSecond);
            return new PointF((float)predictedX, (float)predictedY);
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

        }
    }
}
