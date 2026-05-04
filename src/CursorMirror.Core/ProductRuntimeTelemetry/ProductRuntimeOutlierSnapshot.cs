using System;

namespace CursorMirror.ProductRuntimeTelemetry
{
    public sealed class ProductRuntimeOutlierSnapshot
    {
        public ProductRuntimeOutlierSnapshot(
            long stopwatchFrequency,
            DateTime capturedUtc,
            int capacity,
            long droppedCount,
            long lastSequence,
            ProductRuntimeOutlierEvent[] events)
        {
            StopwatchFrequency = stopwatchFrequency;
            CapturedUtc = capturedUtc;
            Capacity = capacity;
            DroppedCount = droppedCount;
            LastSequence = lastSequence;
            Events = events ?? new ProductRuntimeOutlierEvent[0];
        }

        public long StopwatchFrequency { get; private set; }

        public DateTime CapturedUtc { get; private set; }

        public int Capacity { get; private set; }

        public long DroppedCount { get; private set; }

        public long LastSequence { get; private set; }

        public ProductRuntimeOutlierEvent[] Events { get; private set; }
    }
}
