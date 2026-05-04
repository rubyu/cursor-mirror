using System;
using System.Diagnostics;
using System.Threading;

namespace CursorMirror.ProductRuntimeTelemetry
{
    public sealed class ProductRuntimeOutlierRecorder
    {
        private const int DefaultCapacity = 16384;
        private static readonly ProductRuntimeOutlierRecorder DisabledRecorder = new ProductRuntimeOutlierRecorder(0, false);
        private static ProductRuntimeOutlierRecorder _current = CreateFromEnvironment();

        private readonly ProductRuntimeOutlierEvent[] _events;
        private readonly bool _enabled;
        private long _sequence;

        private ProductRuntimeOutlierRecorder(int capacity, bool enabled)
        {
            _enabled = enabled && capacity > 0;
            _events = _enabled ? new ProductRuntimeOutlierEvent[capacity] : new ProductRuntimeOutlierEvent[0];
        }

        public static ProductRuntimeOutlierRecorder Disabled
        {
            get { return DisabledRecorder; }
        }

        public static ProductRuntimeOutlierRecorder Current
        {
            get { return _current; }
            set { _current = value ?? DisabledRecorder; }
        }

        public bool IsEnabled
        {
            get { return _enabled; }
        }

        public int Capacity
        {
            get { return _events.Length; }
        }

        public long DroppedCount
        {
            get
            {
                long sequence = Interlocked.Read(ref _sequence);
                int capacity = Capacity;
                return sequence > capacity ? sequence - capacity : 0;
            }
        }

        public static ProductRuntimeOutlierRecorder Create(int capacity)
        {
            return new ProductRuntimeOutlierRecorder(capacity, true);
        }

        public static long TicksToMicroseconds(long ticks)
        {
            if (ticks == 0)
            {
                return 0;
            }

            return (long)Math.Round(ticks * 1000000.0 / Stopwatch.Frequency);
        }

        public void Record(ref ProductRuntimeOutlierEvent runtimeEvent)
        {
            if (!_enabled)
            {
                return;
            }

            long sequence = Interlocked.Increment(ref _sequence);
            runtimeEvent.Sequence = sequence;
            if (runtimeEvent.StopwatchTicks == 0)
            {
                runtimeEvent.StopwatchTicks = Stopwatch.GetTimestamp();
            }

            if (runtimeEvent.ThreadId == 0)
            {
                runtimeEvent.ThreadId = Thread.CurrentThread.ManagedThreadId;
            }

            _events[(int)((sequence - 1) % _events.Length)] = runtimeEvent;
        }

        public ProductRuntimeOutlierSnapshot Snapshot()
        {
            if (!_enabled)
            {
                return new ProductRuntimeOutlierSnapshot(
                    Stopwatch.Frequency,
                    DateTime.UtcNow,
                    Capacity,
                    0,
                    0,
                    new ProductRuntimeOutlierEvent[0]);
            }

            long sequence = Interlocked.Read(ref _sequence);
            int count = (int)Math.Min(sequence, _events.Length);
            ProductRuntimeOutlierEvent[] events = new ProductRuntimeOutlierEvent[count];
            long firstSequence = sequence - count + 1;
            for (int i = 0; i < count; i++)
            {
                long itemSequence = firstSequence + i;
                events[i] = _events[(int)((itemSequence - 1) % _events.Length)];
            }

            return new ProductRuntimeOutlierSnapshot(
                Stopwatch.Frequency,
                DateTime.UtcNow,
                Capacity,
                DroppedCount,
                sequence,
                events);
        }

        private static ProductRuntimeOutlierRecorder CreateFromEnvironment()
        {
            string enabled = Environment.GetEnvironmentVariable("CURSOR_MIRROR_PRODUCT_RUNTIME_OUTLIER_V1");
            if (!IsTruthy(enabled))
            {
                return DisabledRecorder;
            }

            int capacity = DefaultCapacity;
            string capacityValue = Environment.GetEnvironmentVariable("CURSOR_MIRROR_PRODUCT_RUNTIME_OUTLIER_CAPACITY");
            int parsedCapacity;
            if (int.TryParse(capacityValue, out parsedCapacity) && parsedCapacity > 0)
            {
                capacity = parsedCapacity;
            }

            return Create(capacity);
        }

        private static bool IsTruthy(string value)
        {
            string normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
            return normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on";
        }
    }
}
