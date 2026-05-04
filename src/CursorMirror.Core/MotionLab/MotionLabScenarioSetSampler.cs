using System;

namespace CursorMirror.MotionLab
{
    public sealed class MotionLabScenarioSetSampler
    {
        private readonly MotionLabScenarioSet _scenarioSet;
        private readonly MotionLabSampler[] _samplers;
        private readonly double[] _scenarioStarts;
        private readonly double _totalDurationMilliseconds;

        public MotionLabScenarioSetSampler(MotionLabScenarioSet scenarioSet)
        {
            if (scenarioSet == null)
            {
                throw new ArgumentNullException("scenarioSet");
            }

            _scenarioSet = scenarioSet;
            MotionLabScript[] scenarios = scenarioSet.Scenarios ?? new MotionLabScript[0];
            _samplers = new MotionLabSampler[scenarios.Length];
            _scenarioStarts = new double[scenarios.Length];
            double start = 0;
            for (int i = 0; i < scenarios.Length; i++)
            {
                MotionLabScript scenario = scenarios[i] ?? new MotionLabScript();
                _scenarioStarts[i] = start;
                _samplers[i] = new MotionLabSampler(scenario);
                start += Math.Max(1.0, scenario.DurationMilliseconds);
            }

            _totalDurationMilliseconds = Math.Max(1.0, start);
        }

        public double TotalDurationMilliseconds
        {
            get { return _totalDurationMilliseconds; }
        }

        public int ScenarioCount
        {
            get { return _samplers.Length; }
        }

        public MotionLabScenarioSetSample GetSample(double elapsedMilliseconds)
        {
            if (_samplers.Length == 0)
            {
                return new MotionLabScenarioSetSample(0, 0, 0, 0, 0, 0, 0);
            }

            double clamped = Math.Max(0.0, Math.Min(_totalDurationMilliseconds, elapsedMilliseconds));
            int scenarioIndex = FindScenarioIndex(clamped);
            MotionLabScript scenario = _scenarioSet.Scenarios[scenarioIndex];
            double scenarioElapsed = Math.Max(0.0, Math.Min(
                Math.Max(1.0, scenario.DurationMilliseconds),
                clamped - _scenarioStarts[scenarioIndex]));
            MotionLabSample sample = _samplers[scenarioIndex].GetSample(scenarioElapsed);
            return new MotionLabScenarioSetSample(
                clamped,
                scenarioIndex,
                sample.ElapsedMilliseconds,
                sample.Progress,
                sample.X,
                sample.Y,
                sample.VelocityPixelsPerSecond,
                sample.MovementPhase,
                sample.HoldIndex,
                sample.PhaseElapsedMilliseconds);
        }

        public MotionLabSampler GetScenarioSampler(int scenarioIndex)
        {
            if (scenarioIndex < 0 || scenarioIndex >= _samplers.Length)
            {
                throw new ArgumentOutOfRangeException("scenarioIndex");
            }

            return _samplers[scenarioIndex];
        }

        private int FindScenarioIndex(double elapsedMilliseconds)
        {
            for (int i = 0; i < _scenarioStarts.Length; i++)
            {
                MotionLabScript scenario = _scenarioSet.Scenarios[i];
                double end = _scenarioStarts[i] + Math.Max(1.0, scenario.DurationMilliseconds);
                if (elapsedMilliseconds < end || i == _scenarioStarts.Length - 1)
                {
                    return i;
                }
            }

            return _scenarioStarts.Length - 1;
        }
    }
}
