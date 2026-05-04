using System;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace CursorMirror.ProductRuntimeTelemetry
{
    public sealed class ProductRuntimeOutlierPackageWriter
    {
        public void Write(string path, ProductRuntimeOutlierSnapshot snapshot)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("Output path must not be empty.", "path");
            }

            if (snapshot == null)
            {
                throw new ArgumentNullException("snapshot");
            }

            string directory = Path.GetDirectoryName(Path.GetFullPath(path));
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            if (File.Exists(path))
            {
                File.Delete(path);
            }

            using (FileStream stream = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
            using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Create))
            {
                WriteMetadata(archive, snapshot);
                WriteEvents(archive, snapshot);
            }
        }

        private static void WriteMetadata(ZipArchive archive, ProductRuntimeOutlierSnapshot snapshot)
        {
            ZipArchiveEntry entry = archive.CreateEntry("metadata.json", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            using (StreamWriter writer = new StreamWriter(stream, Encoding.UTF8))
            {
                writer.WriteLine("{");
                writer.WriteLine("  \"format\": \"product-runtime-outlier-v1\",");
                writer.WriteLine("  \"capturedUtc\": \"" + Escape(snapshot.CapturedUtc.ToString("o", CultureInfo.InvariantCulture)) + "\",");
                writer.WriteLine("  \"stopwatchFrequency\": " + snapshot.StopwatchFrequency.ToString(CultureInfo.InvariantCulture) + ",");
                writer.WriteLine("  \"capacity\": " + snapshot.Capacity.ToString(CultureInfo.InvariantCulture) + ",");
                writer.WriteLine("  \"droppedCount\": " + snapshot.DroppedCount.ToString(CultureInfo.InvariantCulture) + ",");
                writer.WriteLine("  \"lastSequence\": " + snapshot.LastSequence.ToString(CultureInfo.InvariantCulture) + ",");
                writer.WriteLine("  \"eventCount\": " + snapshot.Events.Length.ToString(CultureInfo.InvariantCulture));
                writer.WriteLine("}");
            }
        }

        private static void WriteEvents(ZipArchive archive, ProductRuntimeOutlierSnapshot snapshot)
        {
            ZipArchiveEntry entry = archive.CreateEntry("product-runtime-outlier-events.csv", CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            using (StreamWriter writer = new StreamWriter(stream, Encoding.UTF8))
            {
                writer.WriteLine("sequence,stopwatchTicks,eventKind,threadId,loopIteration,targetVBlankTicks,plannedWakeTicks,refreshPeriodTicks,dwmReadDurationTicks,decisionDurationTicks,waitDurationTicks,tickDurationTicks,wakeLateMicroseconds,vBlankLeadMicroseconds,processedMessageCountBeforeTick,processedMessageDurationTicksBeforeTick,maxMessageDispatchTicksBeforeTick,messageWakeCount,waitReturnReason,fineSleepZeroCount,fineSpinCount,pollDurationTicks,selectTargetDurationTicks,predictDurationTicks,moveOverlayDurationTicks,applyOpacityDurationTicks,tickTotalDurationTicks,pollSampleAvailable,stalePollSample,predictionEnabled,rawX,rawY,displayX,displayY,gen0Before,gen0After,gen1Before,gen1After,gen2Before,gen2After,overlayOperation,x,y,width,height,alpha,hadBitmap,getDcTicks,createCompatibleDcTicks,getHbitmapTicks,selectObjectTicks,updateLayeredWindowTicks,cleanupTicks,totalTicks,succeeded,lastWin32Error");
                for (int i = 0; i < snapshot.Events.Length; i++)
                {
                    ProductRuntimeOutlierEvent item = snapshot.Events[i];
                    writer.WriteLine(
                        item.Sequence.ToString(CultureInfo.InvariantCulture) + "," +
                        item.StopwatchTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.EventKind.ToString(CultureInfo.InvariantCulture) + "," +
                        item.ThreadId.ToString(CultureInfo.InvariantCulture) + "," +
                        item.LoopIteration.ToString(CultureInfo.InvariantCulture) + "," +
                        item.TargetVBlankTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.PlannedWakeTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.RefreshPeriodTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.DwmReadDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.DecisionDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.WaitDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.TickDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.WakeLateMicroseconds.ToString(CultureInfo.InvariantCulture) + "," +
                        item.VBlankLeadMicroseconds.ToString(CultureInfo.InvariantCulture) + "," +
                        item.ProcessedMessageCountBeforeTick.ToString(CultureInfo.InvariantCulture) + "," +
                        item.ProcessedMessageDurationTicksBeforeTick.ToString(CultureInfo.InvariantCulture) + "," +
                        item.MaxMessageDispatchTicksBeforeTick.ToString(CultureInfo.InvariantCulture) + "," +
                        item.MessageWakeCount.ToString(CultureInfo.InvariantCulture) + "," +
                        item.WaitReturnReason.ToString(CultureInfo.InvariantCulture) + "," +
                        item.FineSleepZeroCount.ToString(CultureInfo.InvariantCulture) + "," +
                        item.FineSpinCount.ToString(CultureInfo.InvariantCulture) + "," +
                        item.PollDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.SelectTargetDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.PredictDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.MoveOverlayDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.ApplyOpacityDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.TickTotalDurationTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.PollSampleAvailable.ToString(CultureInfo.InvariantCulture) + "," +
                        item.StalePollSample.ToString(CultureInfo.InvariantCulture) + "," +
                        item.PredictionEnabled.ToString(CultureInfo.InvariantCulture) + "," +
                        item.RawX.ToString(CultureInfo.InvariantCulture) + "," +
                        item.RawY.ToString(CultureInfo.InvariantCulture) + "," +
                        item.DisplayX.ToString(CultureInfo.InvariantCulture) + "," +
                        item.DisplayY.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Gen0Before.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Gen0After.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Gen1Before.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Gen1After.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Gen2Before.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Gen2After.ToString(CultureInfo.InvariantCulture) + "," +
                        item.OverlayOperation.ToString(CultureInfo.InvariantCulture) + "," +
                        item.X.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Y.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Width.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Height.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Alpha.ToString(CultureInfo.InvariantCulture) + "," +
                        item.HadBitmap.ToString(CultureInfo.InvariantCulture) + "," +
                        item.GetDcTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.CreateCompatibleDcTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.GetHbitmapTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.SelectObjectTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.UpdateLayeredWindowTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.CleanupTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.TotalTicks.ToString(CultureInfo.InvariantCulture) + "," +
                        item.Succeeded.ToString(CultureInfo.InvariantCulture) + "," +
                        item.LastWin32Error.ToString(CultureInfo.InvariantCulture));
                }
            }
        }

        private static string Escape(string value)
        {
            return (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
