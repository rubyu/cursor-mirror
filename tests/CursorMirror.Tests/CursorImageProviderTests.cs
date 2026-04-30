using System;
using System.Drawing;
using CursorMirror;

namespace CursorMirror.Tests
{
    internal static class CursorImageProviderTests
    {
        public static void AddTo(TestSuite suite)
        {
            suite.Add("COT-MCU-1", CurrentCursorHandleCopied);
            suite.Add("COT-MCU-2", HotSpotExtracted);
            suite.Add("COT-MCU-3", InvalidCursorCaptureIsNonFatal);
            suite.Add("COT-MCU-4", CopiedIconHandleDisposed);
        }

        // Current cursor handle copied [COT-MCU-1]
        private static void CurrentCursorHandleCopied()
        {
            FakeCursorNativeMethods nativeMethods = new FakeCursorNativeMethods();
            CursorImageProvider provider = new CursorImageProvider(nativeMethods);
            CursorCapture capture;

            bool ok = provider.TryCapture(out capture);

            TestAssert.True(ok, "capture must succeed");
            TestAssert.Equal(1, nativeMethods.CopyIconCallCount, "CopyIcon call count");
            TestAssert.Equal(nativeMethods.CursorHandle, nativeMethods.LastCopyIconInput, "CopyIcon input handle");
            TestAssert.Equal(nativeMethods.CursorHandle, capture.CursorHandle, "reported cursor handle");
            capture.Dispose();
        }

        // Hot spot extracted [COT-MCU-2]
        private static void HotSpotExtracted()
        {
            FakeCursorNativeMethods nativeMethods = new FakeCursorNativeMethods();
            nativeMethods.HotSpotX = 9;
            nativeMethods.HotSpotY = 11;
            CursorImageProvider provider = new CursorImageProvider(nativeMethods);
            CursorCapture capture;

            bool ok = provider.TryCapture(out capture);

            TestAssert.True(ok, "capture must succeed");
            TestAssert.Equal(new Point(9, 11), capture.HotSpot, "hot spot");
            TestAssert.Equal(new Size(32, 32), capture.Bitmap.Size, "bitmap size");
            capture.Dispose();
        }

        // Invalid cursor capture is non-fatal [COT-MCU-3]
        private static void InvalidCursorCaptureIsNonFatal()
        {
            FakeCursorNativeMethods nativeMethods = new FakeCursorNativeMethods();
            nativeMethods.GetCursorInfoResult = false;
            CursorImageProvider provider = new CursorImageProvider(nativeMethods);
            CursorCapture capture;

            bool ok = provider.TryCapture(out capture);

            TestAssert.False(ok, "capture must fail without throwing");
            TestAssert.True(capture == null, "failed capture must return null");
            TestAssert.Equal(0, nativeMethods.CopyIconCallCount, "CopyIcon must not be called");
        }

        // Copied icon handle disposed [COT-MCU-4]
        private static void CopiedIconHandleDisposed()
        {
            FakeCursorNativeMethods nativeMethods = new FakeCursorNativeMethods();
            nativeMethods.DrawIconExResult = false;
            CursorImageProvider provider = new CursorImageProvider(nativeMethods);
            CursorCapture capture;

            bool ok = provider.TryCapture(out capture);

            TestAssert.False(ok, "draw failure must fail capture");
            TestAssert.True(capture == null, "failed capture must return null");
            TestAssert.Equal(1, nativeMethods.DestroyIconCallCount, "copied icon must be destroyed");
            TestAssert.Equal(2, nativeMethods.DeleteObjectCallCount, "bitmap handles must be deleted");
        }
    }
}
