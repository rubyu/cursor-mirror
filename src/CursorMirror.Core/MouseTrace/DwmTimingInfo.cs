using System.Runtime.InteropServices;

namespace CursorMirror.MouseTrace
{
    [StructLayout(LayoutKind.Sequential)]
    public struct DwmUnsignedRatio
    {
        public uint Numerator;
        public uint Denominator;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct DwmTimingInfo
    {
        public uint Size;
        public DwmUnsignedRatio RateRefresh;
        public ulong QpcRefreshPeriod;
        public DwmUnsignedRatio RateCompose;
        public ulong QpcVBlank;
        public ulong RefreshCount;
        public uint DxRefresh;
        public ulong QpcCompose;
        public ulong Frame;
        public uint DxPresent;
        public ulong RefreshFrame;
        public ulong FrameSubmitted;
        public uint DxPresentSubmitted;
        public ulong FrameConfirmed;
        public uint DxPresentConfirmed;
        public ulong RefreshConfirmed;
        public uint DxRefreshConfirmed;
        public ulong FramesLate;
        public uint FramesOutstanding;
        public ulong FrameDisplayed;
        public ulong QpcFrameDisplayed;
        public ulong RefreshFrameDisplayed;
        public ulong FrameComplete;
        public ulong QpcFrameComplete;
        public ulong FramePending;
        public ulong QpcFramePending;
        public ulong FramesDisplayed;
        public ulong FramesComplete;
        public ulong FramesPending;
        public ulong FramesAvailable;
        public ulong FramesDropped;
        public ulong FramesMissed;
        public ulong RefreshNextDisplayed;
        public ulong RefreshNextPresented;
        public ulong RefreshesDisplayed;
        public ulong RefreshesPresented;
        public ulong RefreshStarted;
        public ulong PixelsReceived;
        public ulong PixelsDrawn;
        public ulong BuffersEmpty;
    }
}
