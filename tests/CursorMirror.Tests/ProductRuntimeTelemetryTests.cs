using System;
using System.IO;
using System.IO.Compression;
using CursorMirror.ProductRuntimeTelemetry;

namespace CursorMirror.Tests
{
    internal static class ProductRuntimeTelemetryTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-PRO-01", DisabledRecorderCapturesNoEvents);
            suite.Add("COT-PRO-02", RingRecorderSnapshotsLatestEvents);
            suite.Add("COT-PRO-03", PackageWriterWritesMetadataAndEvents);
        }

        private static void DisabledRecorderCapturesNoEvents()
        {
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Disabled;
            ProductRuntimeOutlierEvent runtimeEvent = new ProductRuntimeOutlierEvent();
            runtimeEvent.EventKind = (int)ProductRuntimeOutlierEventKind.SchedulerTick;
            recorder.Record(ref runtimeEvent);

            ProductRuntimeOutlierSnapshot snapshot = recorder.Snapshot();
            TestAssert.Equal(0, snapshot.Events.Length, "disabled recorder event count");
            TestAssert.Equal(0L, snapshot.DroppedCount, "disabled recorder dropped count");
        }

        private static void RingRecorderSnapshotsLatestEvents()
        {
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Create(2);

            ProductRuntimeOutlierEvent first = new ProductRuntimeOutlierEvent();
            first.EventKind = (int)ProductRuntimeOutlierEventKind.SchedulerTick;
            first.LoopIteration = 1;
            recorder.Record(ref first);

            ProductRuntimeOutlierEvent second = new ProductRuntimeOutlierEvent();
            second.EventKind = (int)ProductRuntimeOutlierEventKind.ControllerTick;
            second.LoopIteration = 2;
            recorder.Record(ref second);

            ProductRuntimeOutlierEvent third = new ProductRuntimeOutlierEvent();
            third.EventKind = (int)ProductRuntimeOutlierEventKind.OverlayOperation;
            third.LoopIteration = 3;
            recorder.Record(ref third);

            ProductRuntimeOutlierSnapshot snapshot = recorder.Snapshot();
            TestAssert.Equal(2, snapshot.Events.Length, "ring snapshot event count");
            TestAssert.Equal(1L, snapshot.DroppedCount, "ring dropped count");
            TestAssert.Equal(2L, snapshot.Events[0].Sequence, "first retained sequence");
            TestAssert.Equal(3L, snapshot.Events[1].Sequence, "last retained sequence");
            TestAssert.Equal(2L, snapshot.Events[0].LoopIteration, "first retained payload");
            TestAssert.Equal(3L, snapshot.Events[1].LoopIteration, "last retained payload");
        }

        private static void PackageWriterWritesMetadataAndEvents()
        {
            ProductRuntimeOutlierRecorder recorder = ProductRuntimeOutlierRecorder.Create(4);
            ProductRuntimeOutlierEvent runtimeEvent = new ProductRuntimeOutlierEvent();
            runtimeEvent.EventKind = (int)ProductRuntimeOutlierEventKind.OverlayOperation;
            runtimeEvent.OverlayOperation = (int)ProductOverlayOperation.Move;
            runtimeEvent.X = 10;
            runtimeEvent.Y = 20;
            recorder.Record(ref runtimeEvent);

            string directory = Path.Combine(Path.GetTempPath(), "CursorMirrorProductRuntimeTelemetryTests");
            Directory.CreateDirectory(directory);
            string path = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                new ProductRuntimeOutlierPackageWriter().Write(path, recorder.Snapshot());
                using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    TestAssert.True(archive.GetEntry("metadata.json") != null, "metadata entry");
                    TestAssert.True(archive.GetEntry("product-runtime-outlier-events.csv") != null, "events entry");
                    using (StreamReader reader = new StreamReader(archive.GetEntry("product-runtime-outlier-events.csv").Open()))
                    {
                        string header = reader.ReadLine();
                        string row = reader.ReadLine();
                        TestAssert.True(header.IndexOf("sequence,stopwatchTicks,eventKind", StringComparison.Ordinal) == 0, "events header");
                        TestAssert.True(row != null && row.Length > 0, "events row");
                    }
                }
            }
            finally
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
        }
    }
}
