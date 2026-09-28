/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include <cstring>
#include <iterator>
#include <limits>
#include <vector>

#include "2D.h"
#include "FilterNodeSoftware.h"
#include "gtest/gtest.h"

using namespace mozilla;
using namespace mozilla::gfx;

namespace {

class TileTestInput final : public FilterNodeSoftware {
 public:
  MOZ_DECLARE_REFCOUNTED_VIRTUAL_TYPENAME(TileTestInput, override)

  std::vector<IntRect> mRects;

 protected:
  IntRect GetOutputRectInRect(const IntRect& aRect) override { return aRect; }

  already_AddRefed<DataSourceSurface> GetOutput(const IntRect& aRect) override {
    return Render(aRect);
  }

  already_AddRefed<DataSourceSurface> Render(const IntRect& aRect) override {
    mRects.push_back(aRect);
    RefPtr<DataSourceSurface> surface =
        Factory::CreateDataSourceSurface(aRect.Size(), SurfaceFormat::A8, true);
    if (!surface) {
      return nullptr;
    }
    DataSourceSurface::ScopedMap map(surface, DataSourceSurface::WRITE);
    if (!map.IsMapped()) {
      return nullptr;
    }
    for (int32_t y = 0; y < aRect.Height(); ++y) {
      std::memset(map.GetData() + y * map.GetStride(), 0x7f, aRect.Width());
    }
    return surface.forget();
  }
};

class TileTestNode final : public FilterNodeTileSoftware {
 public:
  MOZ_DECLARE_REFCOUNTED_VIRTUAL_TYPENAME(TileTestNode, override)
  using FilterNodeTileSoftware::Render;
};

}  // namespace

TEST(Moz2D, TileAcrossCoordinateLimits)
{
  constexpr int32_t extent = std::numeric_limits<int32_t>::max() - 1;
  constexpr int32_t last = extent - 6;
  RefPtr<TileTestInput> input = MakeRefPtr<TileTestInput>();
  RefPtr<TileTestNode> tile = MakeRefPtr<TileTestNode>();
  tile->SetInput(IN_TILE_IN, input.get());
  tile->SetAttribute(ATT_TILE_SOURCE_RECT, IntRect(-4, -4, extent, extent));

  RefPtr<DataSourceSurface> output = tile->Render(IntRect(-6, -6, 4, 4));
  ASSERT_TRUE(output);
  const IntRect expected[] = {IntRect(last, last, 2, 2),
                              IntRect(last, -4, 2, 2), IntRect(-4, last, 2, 2),
                              IntRect(-4, -4, 2, 2)};
  ASSERT_EQ(input->mRects.size(), std::size(expected));
  for (size_t i = 0; i < std::size(expected); ++i) {
    EXPECT_EQ(input->mRects[i], expected[i]);
  }

  DataSourceSurface::ScopedMap map(output, DataSourceSurface::READ);
  ASSERT_TRUE(map.IsMapped());
  for (int32_t y = 0; y < 4; ++y) {
    for (int32_t x = 0; x < 4; ++x) {
      EXPECT_EQ(map.GetData()[y * map.GetStride() + x], 0x7f);
    }
  }
}
