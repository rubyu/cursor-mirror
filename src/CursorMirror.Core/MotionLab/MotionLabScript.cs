using System.Runtime.Serialization;

namespace CursorMirror.MotionLab
{
    [DataContract]
    public sealed class MotionLabScript
    {
        public MotionLabScript()
        {
            SchemaVersion = "cursor-mirror-motion-script/1";
            GenerationProfile = MotionLabGenerationProfile.Balanced;
            ControlPoints = new MotionLabPoint[0];
            SpeedPoints = new MotionLabSpeedPoint[0];
            HoldSegments = new MotionLabHoldSegment[0];
        }

        [DataMember(Order = 1)]
        public string SchemaVersion { get; set; }

        [DataMember(Order = 2)]
        public int Seed { get; set; }

        [DataMember(Order = 3)]
        public MotionLabBounds Bounds { get; set; }

        [DataMember(Order = 4)]
        public double DurationMilliseconds { get; set; }

        [DataMember(Order = 5)]
        public int SampleRateHz { get; set; }

        [DataMember(Order = 6)]
        public MotionLabPoint[] ControlPoints { get; set; }

        [DataMember(Order = 7)]
        public MotionLabSpeedPoint[] SpeedPoints { get; set; }

        [DataMember(Order = 8)]
        public MotionLabHoldSegment[] HoldSegments { get; set; }

        [DataMember(Order = 9)]
        public string GenerationProfile { get; set; }
    }

    public static class MotionLabGenerationProfile
    {
        public const string Balanced = "balanced";
        public const string RealTraceWeighted = "real-trace-weighted";
    }

    [DataContract]
    public sealed class MotionLabScenarioSet
    {
        public MotionLabScenarioSet()
        {
            SchemaVersion = "cursor-mirror-motion-scenarios/1";
            GenerationProfile = MotionLabGenerationProfile.Balanced;
            Scenarios = new MotionLabScript[0];
        }

        [DataMember(Order = 1)]
        public string SchemaVersion { get; set; }

        [DataMember(Order = 2)]
        public int Seed { get; set; }

        [DataMember(Order = 3)]
        public string GenerationProfile { get; set; }

        [DataMember(Order = 4)]
        public double DurationMilliseconds { get; set; }

        [DataMember(Order = 5)]
        public double ScenarioDurationMilliseconds { get; set; }

        [DataMember(Order = 6)]
        public int SampleRateHz { get; set; }

        [DataMember(Order = 7)]
        public MotionLabScript[] Scenarios { get; set; }
    }

    [DataContract]
    public sealed class MotionLabBounds
    {
        [DataMember(Order = 1)]
        public int X { get; set; }

        [DataMember(Order = 2)]
        public int Y { get; set; }

        [DataMember(Order = 3)]
        public int Width { get; set; }

        [DataMember(Order = 4)]
        public int Height { get; set; }
    }

    [DataContract]
    public sealed class MotionLabPoint
    {
        public MotionLabPoint()
        {
        }

        public MotionLabPoint(double x, double y)
        {
            X = x;
            Y = y;
        }

        [DataMember(Order = 1)]
        public double X { get; set; }

        [DataMember(Order = 2)]
        public double Y { get; set; }
    }

    [DataContract]
    public sealed class MotionLabSpeedPoint
    {
        [DataMember(Order = 1)]
        public double Progress { get; set; }

        [DataMember(Order = 2)]
        public double Multiplier { get; set; }

        [DataMember(Order = 3)]
        public double EasingWidth { get; set; }

        [DataMember(Order = 4)]
        public string Easing { get; set; }
    }

    [DataContract]
    public sealed class MotionLabHoldSegment
    {
        [DataMember(Order = 1)]
        public double Progress { get; set; }

        [DataMember(Order = 2)]
        public double DurationMilliseconds { get; set; }

        [DataMember(Order = 3)]
        public double ResumeEasingMilliseconds { get; set; }
    }

    public sealed class MotionLabSample
    {
        public MotionLabSample(
            double elapsedMilliseconds,
            double progress,
            double x,
            double y,
            double velocityPixelsPerSecond)
            : this(elapsedMilliseconds, progress, x, y, velocityPixelsPerSecond, MotionLabMovementPhase.Moving, -1, elapsedMilliseconds)
        {
        }

        public MotionLabSample(
            double elapsedMilliseconds,
            double progress,
            double x,
            double y,
            double velocityPixelsPerSecond,
            string movementPhase,
            int holdIndex,
            double phaseElapsedMilliseconds)
        {
            ElapsedMilliseconds = elapsedMilliseconds;
            Progress = progress;
            X = x;
            Y = y;
            VelocityPixelsPerSecond = velocityPixelsPerSecond;
            MovementPhase = string.IsNullOrWhiteSpace(movementPhase) ? MotionLabMovementPhase.Moving : movementPhase;
            HoldIndex = holdIndex;
            PhaseElapsedMilliseconds = phaseElapsedMilliseconds;
        }

        public double ElapsedMilliseconds { get; private set; }
        public double Progress { get; private set; }
        public double X { get; private set; }
        public double Y { get; private set; }
        public double VelocityPixelsPerSecond { get; private set; }
        public string MovementPhase { get; private set; }
        public int HoldIndex { get; private set; }
        public double PhaseElapsedMilliseconds { get; private set; }
    }

    public sealed class MotionLabScenarioSetSample
    {
        public MotionLabScenarioSetSample(
            double elapsedMilliseconds,
            int scenarioIndex,
            double scenarioElapsedMilliseconds,
            double progress,
            double x,
            double y,
            double velocityPixelsPerSecond)
            : this(
                elapsedMilliseconds,
                scenarioIndex,
                scenarioElapsedMilliseconds,
                progress,
                x,
                y,
                velocityPixelsPerSecond,
                MotionLabMovementPhase.Moving,
                -1,
                scenarioElapsedMilliseconds)
        {
        }

        public MotionLabScenarioSetSample(
            double elapsedMilliseconds,
            int scenarioIndex,
            double scenarioElapsedMilliseconds,
            double progress,
            double x,
            double y,
            double velocityPixelsPerSecond,
            string movementPhase,
            int holdIndex,
            double phaseElapsedMilliseconds)
        {
            ElapsedMilliseconds = elapsedMilliseconds;
            ScenarioIndex = scenarioIndex;
            ScenarioElapsedMilliseconds = scenarioElapsedMilliseconds;
            Progress = progress;
            X = x;
            Y = y;
            VelocityPixelsPerSecond = velocityPixelsPerSecond;
            MovementPhase = string.IsNullOrWhiteSpace(movementPhase) ? MotionLabMovementPhase.Moving : movementPhase;
            HoldIndex = holdIndex;
            PhaseElapsedMilliseconds = phaseElapsedMilliseconds;
        }

        public double ElapsedMilliseconds { get; private set; }
        public int ScenarioIndex { get; private set; }
        public double ScenarioElapsedMilliseconds { get; private set; }
        public double Progress { get; private set; }
        public double X { get; private set; }
        public double Y { get; private set; }
        public double VelocityPixelsPerSecond { get; private set; }
        public string MovementPhase { get; private set; }
        public int HoldIndex { get; private set; }
        public double PhaseElapsedMilliseconds { get; private set; }
    }

    public static class MotionLabMovementPhase
    {
        public const string Moving = "moving";
        public const string Hold = "hold";
        public const string Resume = "resume";
    }
}
