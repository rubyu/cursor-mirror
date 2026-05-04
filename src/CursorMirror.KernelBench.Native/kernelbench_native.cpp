#include <immintrin.h>
#include <intrin.h>

#include <stdint.h>

namespace
{
    const uint32_t FeatureAvx = 1u << 0;
    const uint32_t FeatureAvx2 = 1u << 1;
    const uint32_t FeatureFma3 = 1u << 2;
    const uint32_t FeatureAvx512F = 1u << 3;

    bool HasBit(int value, int bit)
    {
        return (value & (1 << bit)) != 0;
    }

    bool GetCpuid(int leaf, int subleaf, int regs[4])
    {
        int maxLeaf[4] = {};
        __cpuid(maxLeaf, 0);
        if (maxLeaf[0] < leaf)
        {
            regs[0] = regs[1] = regs[2] = regs[3] = 0;
            return false;
        }

        __cpuidex(regs, leaf, subleaf);
        return true;
    }

    uint32_t DetectCpuFeatures()
    {
        int leaf1[4] = {};
        if (!GetCpuid(1, 0, leaf1))
        {
            return 0;
        }

        const bool osxsave = HasBit(leaf1[2], 27);
        const bool avxInstruction = HasBit(leaf1[2], 28);
        const bool fmaInstruction = HasBit(leaf1[2], 12);
        if (!osxsave)
        {
            return 0;
        }

        const unsigned __int64 xcr0 = _xgetbv(0);
        const bool osAvxState = (xcr0 & 0x6) == 0x6;
        if (!avxInstruction || !osAvxState)
        {
            return 0;
        }

        uint32_t features = FeatureAvx;
        if (fmaInstruction)
        {
            features |= FeatureFma3;
        }

        int leaf7[4] = {};
        if (GetCpuid(7, 0, leaf7))
        {
            if (HasBit(leaf7[1], 5))
            {
                features |= FeatureAvx2;
            }

            const bool osAvx512State = (xcr0 & 0xE0) == 0xE0;
            if (HasBit(leaf7[1], 16) && osAvx512State)
            {
                features |= FeatureAvx512F;
            }
        }

        return features;
    }

    float DotScalarOnce(const float* input, const float* weights, int count)
    {
        float s0 = 0.0f;
        float s1 = 0.0f;
        float s2 = 0.0f;
        float s3 = 0.0f;
        int i = 0;
        for (; i <= count - 4; i += 4)
        {
            s0 += input[i] * weights[i];
            s1 += input[i + 1] * weights[i + 1];
            s2 += input[i + 2] * weights[i + 2];
            s3 += input[i + 3] * weights[i + 3];
        }

        float sum = s0 + s1 + s2 + s3;
        for (; i < count; ++i)
        {
            sum += input[i] * weights[i];
        }

        return sum;
    }

#if defined(CM_KERNEL_AVX2_FMA)
    float DotKernelOnce(const float* input, const float* weights, int count)
    {
        __m256 sum = _mm256_setzero_ps();
        int i = 0;
        for (; i <= count - 8; i += 8)
        {
            const __m256 x = _mm256_loadu_ps(input + i);
            const __m256 w = _mm256_loadu_ps(weights + i);
            sum = _mm256_fmadd_ps(x, w, sum);
        }

        __declspec(align(32)) float lanes[8];
        _mm256_store_ps(lanes, sum);
        float scalar = lanes[0] + lanes[1] + lanes[2] + lanes[3] + lanes[4] + lanes[5] + lanes[6] + lanes[7];
        for (; i < count; ++i)
        {
            scalar += input[i] * weights[i];
        }

        return scalar;
    }

    int VectorWidthFloats()
    {
        return 8;
    }
#elif defined(CM_KERNEL_AVX512F)
    float DotKernelOnce(const float* input, const float* weights, int count)
    {
        __m512 sum = _mm512_setzero_ps();
        int i = 0;
        for (; i <= count - 16; i += 16)
        {
            const __m512 x = _mm512_loadu_ps(input + i);
            const __m512 w = _mm512_loadu_ps(weights + i);
            sum = _mm512_fmadd_ps(x, w, sum);
        }

        __declspec(align(64)) float lanes[16];
        _mm512_store_ps(lanes, sum);
        float scalar = 0.0f;
        for (int lane = 0; lane < 16; ++lane)
        {
            scalar += lanes[lane];
        }

        for (; i < count; ++i)
        {
            scalar += input[i] * weights[i];
        }

        return scalar;
    }

    int VectorWidthFloats()
    {
        return 16;
    }
#else
    float DotKernelOnce(const float* input, const float* weights, int count)
    {
        return DotScalarOnce(input, weights, count);
    }

    int VectorWidthFloats()
    {
        return 1;
    }
#endif
}

extern "C" __declspec(dllexport) int CursorMirrorNativeKernelAbi()
{
    return 1;
}

extern "C" __declspec(dllexport) int CursorMirrorNativeKernelVectorWidthFloats()
{
    return VectorWidthFloats();
}

extern "C" __declspec(dllexport) uint32_t CursorMirrorNativeCpuFeatureMask()
{
    return DetectCpuFeatures();
}

extern "C" __declspec(dllexport) float CursorMirrorDotNative(const float* input, const float* weights, int count, int iterations)
{
    if (input == 0 || weights == 0 || count <= 0 || iterations <= 0)
    {
        return 0.0f;
    }

    float sink = 0.0f;
    for (int iteration = 0; iteration < iterations; ++iteration)
    {
        sink += DotKernelOnce(input, weights, count);
    }

    return sink;
}
