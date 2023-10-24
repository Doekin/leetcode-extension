/*
 * Filename: /home/cc/leetcode-extension/src/treeColor/TreeColorModule.ts
 * Path: /home/cc/leetcode-extension
 * Created Date: Thursday, October 19th 2023, 00:40:45 am
 * Author: ccagml
 *
 * Copyright (c) 2023 ccagml . All rights reserved
 */

import { URLSearchParams } from "url";
import {
  FileDecoration,
  FileDecorationProvider,
  ProviderResult,
  ThemeColor,
  Uri,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { BABA, BabaStr } from "../BABA";

export class TreeColor implements FileDecorationProvider {
  private readonly ITEM_COLOR: { [key: string]: ThemeColor } = {
    easy: new ThemeColor("charts.green"),
    medium: new ThemeColor("charts.yellow"),
    hard: new ThemeColor("charts.red"),

    green: new ThemeColor("charts.green"), // 图表中绿色元素的颜色。  // 低于玩家分数 200分
    blue: new ThemeColor("charts.blue"), // 图表中蓝色元素的颜色。  // 低于玩家分数 50 - 199分
    purple: new ThemeColor("charts.purple"), // 图表中紫色元素的颜色。// 高于玩家50 到低于49
    yellow: new ThemeColor("charts.yellow"), // 图表中黄色元素的颜色。 // 高于玩家50 - 199
    red: new ThemeColor("charts.red"), // 图表中红色元素的颜色。   // 高于200
  };

  public provideFileDecoration(uri: Uri): ProviderResult<FileDecoration> {
    if (!this.isDifficultyBadgeEnabled()) {
      return;
    }

    if (uri.authority !== "problems") {
      return;
    }

    const params: URLSearchParams = new URLSearchParams(uri.query);
    // const difficulty: string = params.get("difficulty")!.toLowerCase();
    const score: string = params.get("score") || "0";
    // const user_score: string = params.get("user_score") || "0";
    const user_score = BABA.getProxy(BabaStr.StatusBarProxy).getUserContestScore();

    const file_color: FileDecoration = {};
    const score_num = Number(score);
    const user_score_num = Number(user_score);
    if (score_num > 0) {
      if (user_score_num > 0) {
        const diff_num = score_num - user_score_num;
        // green: new ThemeColor("charts.green"), // 图表中绿色元素的颜色。  // 低于玩家分数 200分
        // blue: new ThemeColor("charts.blue"),  // 图表中蓝色元素的颜色。  // 低于玩家分数 50 - 199分
        // purple: new ThemeColor("charts.purple"),    // 图表中紫色元素的颜色。// 高于玩家50 到低于49
        // yellow: new ThemeColor("charts.yellow"),    // 图表中黄色元素的颜色。 // 高于玩家50 - 199
        // red: new ThemeColor("charts.red"),   // 图表中红色元素的颜色。   // 高于200
        if (diff_num < -200) {
          file_color.color = this.ITEM_COLOR.green;
          file_color.tooltip = "秒杀难度";
        } else if (diff_num < -50) {
          file_color.color = this.ITEM_COLOR.blue;
          file_color.tooltip = "热身难度";
        } else if (diff_num < 50) {
          file_color.color = this.ITEM_COLOR.purple;
          file_color.tooltip = "普通难度";
        } else if (diff_num < 199) {
          file_color.color = this.ITEM_COLOR.yellow;
          file_color.tooltip = "吃力难度";
        } else {
          file_color.color = this.ITEM_COLOR.red;
          file_color.tooltip = "劝退难度";
        }
      } else {
        file_color.tooltip = "还没有竞赛分";
      }
    }
    return file_color;
  }

  private isDifficultyBadgeEnabled(): boolean {
    const configuration: WorkspaceConfiguration = workspace.getConfiguration("leetcode-problem-rating");
    return configuration.get<boolean>("colorizeProblems", false);
  }
}

export const treeColor: TreeColor = new TreeColor();
