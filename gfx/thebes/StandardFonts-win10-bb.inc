/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

static const char* kBaseFonts[] = {
    "Arial",
    "Cambria Math",
    "Consolas",
    "Courier New",
    "Georgia",
    "Lucida Console",
    "Malgun Gothic",
    "Microsoft Himalaya",
    "Microsoft JhengHei",
    "Microsoft YaHei",
    "MS Gothic",
    "MS PGothic",
    "MV Boli",
    "Segoe UI",
    "SimSun",
    "Sylfaen",
    "Tahoma",
    "Times New Roman",
    "Verdana",
};

struct FontSubstitute {
  const char* substituteName;
  const char* actualFontName;
};

static const FontSubstitute kFontSubstitutes[] = {
    // Common substitutions
    {"Arabic Transparent", "Arial"},
    {"Arabic Transparent Bold", "Arial Bold"},
    {"Arial Baltic", "Arial"},
    {"Arial CE", "Arial"},
    {"Arial CYR", "Arial"},
    {"Arial Greek", "Arial"},
    {"Arial TUR", "Arial"},
    {"Courier New Baltic", "Courier New"},
    {"Courier New CE", "Courier New"},
    {"Courier New CYR", "Courier New"},
    {"Courier New Greek", "Courier New"},
    {"Courier New TUR", "Courier New"},
    {"Helv", "MS Sans Serif"},
    {"Helvetica", "Arial"},
    {"MS Shell Dlg 2", "Tahoma"},
    {"Tahoma Armenian", "Tahoma"},
    {"Times", "Times New Roman"},
    {"Times New Roman Baltic", "Times New Roman"},
    {"Times New Roman CE", "Times New Roman"},
    {"Times New Roman CYR", "Times New Roman"},
    {"Times New Roman Greek", "Times New Roman"},
    {"Times New Roman TUR", "Times New Roman"},
    {"Tms Rmn", "MS Serif"},
    // Common, except Japanese (which uses MS UI Gothic, instead)
    {"MS Shell Dlg", "Microsoft Sans Serif"},
    // Arabic
    {"Arial (Arabic)", "Arial"},
    {"Courier New (Arabic)", "Courier New"},
    {"Times New Roman (Arabic)", "Times New Roman"},
    // Cyrillic + Greek
    {"Courier", "Courier New"},
    // Greek
    {"Fixedsys Greek", "Fixedsys"},
    {"MS Serif Greek", "MS Serif"},
    {"MS Sans Serif Greek", "MS Sans Serif"},
    {"Small Fonts Greek", "Small Fonts"},
    {"System Greek", "System"},
    // Hebrew
    {"Arial (Hebrew)", "Arial"},
    {"Courier New (Hebrew)", "Courier New"},
    {"David Transparent", "David"},
    {"Fixed Miriam Transparent", "Miriam Fixed"},
    {"Miriam Transparent", "Miriam"},
    {"Rod Transparent", "Rod"},
    {"Times New Roman (Hebrew)", "Times New Roman"},
    // Japanese
    {"標準明朝", "ＭＳ 明朝"},
    {"標準ゴシック", "ＭＳ ゴシック"},
    {"ゴシック", "ＭＳ ゴシック"},
    {"ｺﾞｼｯｸ", "ＭＳ ゴシック"},
    {"ｸｰﾘｴ", "Courier"},
    {"ﾀｲﾑｽﾞﾛﾏﾝ", "Times New Roman"},
    {"ﾍﾙﾍﾞﾁｶ", "Arial"},
    // Simplified Chinese
    {"FangSong_GB2312", "FangSong"},
    {"KaiTi_GB2312", "KaiTi"},
};
