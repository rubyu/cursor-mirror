namespace CursorMirror.ProductRuntimeTelemetry
{
    public enum ProductRuntimeOutlierEventKind
    {
        SchedulerTick = 1,
        ControllerTick = 2,
        OverlayOperation = 3
    }

    public enum ProductOverlayOperation
    {
        None = 0,
        ShowCursor = 1,
        Move = 2,
        SetOpacity = 3,
        UpdateLayer = 4
    }

    public enum ProductWaitReturnReason
    {
        None = 0,
        AlreadyDue = 1,
        Timer = 2,
        Message = 3,
        Failed = 4,
        Timeout = 5,
        FallbackSleep = 6,
        Stopping = 7
    }

    public struct ProductRuntimeOutlierEvent
    {
        public long Sequence;
        public long StopwatchTicks;
        public int EventKind;
        public int ThreadId;

        public long LoopIteration;
        public long TargetVBlankTicks;
        public long PlannedWakeTicks;
        public long RefreshPeriodTicks;
        public long DwmReadDurationTicks;
        public long DecisionDurationTicks;
        public long WaitDurationTicks;
        public long TickDurationTicks;
        public long WakeLateMicroseconds;
        public long VBlankLeadMicroseconds;
        public int ProcessedMessageCountBeforeTick;
        public long ProcessedMessageDurationTicksBeforeTick;
        public long MaxMessageDispatchTicksBeforeTick;
        public int MessageWakeCount;
        public int WaitReturnReason;
        public int FineSleepZeroCount;
        public int FineSpinCount;

        public long PollDurationTicks;
        public long SelectTargetDurationTicks;
        public long PredictDurationTicks;
        public long MoveOverlayDurationTicks;
        public long ApplyOpacityDurationTicks;
        public long TickTotalDurationTicks;
        public int PollSampleAvailable;
        public int StalePollSample;
        public int PredictionEnabled;
        public int RawX;
        public int RawY;
        public int DisplayX;
        public int DisplayY;
        public int Gen0Before;
        public int Gen0After;
        public int Gen1Before;
        public int Gen1After;
        public int Gen2Before;
        public int Gen2After;

        public int OverlayOperation;
        public int X;
        public int Y;
        public int Width;
        public int Height;
        public int Alpha;
        public int HadBitmap;
        public long GetDcTicks;
        public long CreateCompatibleDcTicks;
        public long GetHbitmapTicks;
        public long SelectObjectTicks;
        public long UpdateLayeredWindowTicks;
        public long CleanupTicks;
        public long TotalTicks;
        public int Succeeded;
        public int LastWin32Error;
        public long MouseMoveEventsReceived;
        public long MouseMoveEventsCoalesced;
        public long MouseMovePostsQueued;
        public long MouseMoveCallbacksProcessed;
        public long LatestMouseMoveAgeMicroseconds;
        public int OverlayMoveSkipped;
    }
}
