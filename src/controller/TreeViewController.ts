/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/controller/TreeViewController.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, October 27th 2022, 7:43:29 pm
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */

import * as lodash from "lodash";
import * as path from "path";
import * as vscode from "vscode";
import { toNumber } from "lodash";
import * as fs from "fs";
import { Disposable, Uri, window, workspace, ConfigurationChangeEvent } from "vscode";
import {
  SearchNode,
  userContestRankingObj,
  userContestRanKingBase,
  UserStatus,
  IProblem,
  IQuickItemEx,
  Category,
  defaultProblem,
  ProblemState,
  SortingStrategy,
  SearchSetTypeName,
  RootNodeSort,
  SearchSetType,
  ISubmitEvent,
  SORT_ORDER,
  Endpoint,
  OutPutType,
  TestSolutionType,
  ITestSolutionData,
  defaultTestSolutionData,
} from "../model/Model";
import {
  isHideSolvedProblem,
  isHideScoreProblem,
  getDescriptionConfiguration,
  isUseEndpointTranslation,
  enableSideMode,
  getPickOneByRankRangeMin,
  getPickOneByRankRangeMax,
  isShowLocked,
  updateSortingStrategy,
  getSortingStrategy,
  getLeetCodeEndpoint,
  openSettingsEditor,
  fetchProblemLanguage,
  getBelongingWorkspaceFolderUri,
  selectWorkspaceFolder,
  setDefaultLanguage,
} from "../utils/ConfigUtils";
import { NodeModel } from "../model/NodeModel";
import { ISearchSet } from "../model/Model";
import { previewService } from "../service/PreviewService";
import { executeService } from "../service/ExecuteService";
import { getNodeIdFromFile } from "../utils/SystemUtils";
import { promptForOpenOutputChannel, promptForSignIn, promptHintMessage } from "../utils/OutputUtils";
import { treeDataService } from "../service/TreeDataService";
import {
  genFileExt,
  genFileName,
  getyyyymmdd,
  getDayNowStr,
  getTextEditorFilePathByUri,
  usingCmd,
} from "../utils/SystemUtils";
import { IDescriptionConfiguration, isStarShortcut } from "../utils/ConfigUtils";
import * as systemUtils from "../utils/SystemUtils";
import { solutionService } from "../service/SolutionService";
import { eventService } from "../service/EventService";

import * as fse from "fs-extra";
import { submissionService } from "../service/SubmissionService";
import { bricksDataService } from "../service/BricksDataService";
import { groupDao } from "../dao/groupDao";
import { fileMeta, ProblemMeta } from "../utils/problemUtils";
import { BABA, BabaStr } from "../BABA";

// 视图控制器
class TreeViewController implements Disposable {
  private explorerNodeMap: Map<string, NodeModel> = new Map<string, NodeModel>();
  private fidToQid: Map<string, string> = new Map<string, string>();
  private qidToFid: Map<string, string> = new Map<string, string>();
  private companySet: Set<string> = new Set<string>();
  private tagSet: Set<string> = new Set<string>();
  private searchSet: Map<string, ISearchSet> = new Map<string, ISearchSet>();
  private waitTodayQuestion: boolean;
  private waitUserContest: boolean;
  private configurationChangeListener: Disposable;

  constructor() {
    this.configurationChangeListener = workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
      if (event.affectsConfiguration("leetcode-problem-rating.hideScore")) {
        treeDataService.refresh();
        bricksDataService.refresh();
      }
    }, this);
  }

  // 提交问题
  /**
   * It gets the active file path, then submits the solution to the server, and finally refreshes the
   * tree view
   * @param [uri] - The URI of the file to be submitted. If not provided, the currently active file will
   * be submitted.
   * @returns A promise that resolves to a string.
   */
  public async submitSolution(uri?: vscode.Uri): Promise<void> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      promptForSignIn();
      return;
    }

    const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
    if (!filePath) {
      return;
    }

    try {
      const result: string = await executeService.submitSolution(filePath);

      eventService.emit("submitSolutionResult", result);
      // submissionService.show(result);
      // eventService.emit("submit", submissionService.getSubmitEvent());
    } catch (error) {
      await promptForOpenOutputChannel("提交出错了. 请查看控制台信息~", OutPutType.error);
      return;
    }

    await treeDataService.refresh();
    await bricksDataService.refresh();
  }

  // 提交测试用例
  /**
   * It takes the current file, and sends it to the server to be tested
   * @param [uri] - The file path of the file to be submitted. If it is not passed, the currently active
   * file is submitted.
   */
  public async testSolution(uri?: vscode.Uri): Promise<void> {
    try {
      let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
      if (sbp.getStatus() === UserStatus.SignedOut) {
        return;
      }

      const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
      if (!filePath) {
        return;
      }
      const picks: Array<IQuickItemEx<string>> = [];
      picks.push(
        {
          label: "$(pencil) Write directly...",
          description: "",
          detail: "输入框的测试用例",
          value: ":direct",
        },
        {
          label: "$(file-text) Browse...",
          description: "",
          detail: "文件中的测试用例",
          value: ":file",
        }
      );
      const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks);
      if (!choice) {
        return;
      }

      let result: string | undefined;
      let testString: string | undefined;
      let testFile: vscode.Uri[] | undefined;

      let tsd: ITestSolutionData = Object.assign({}, defaultTestSolutionData, {});

      switch (choice.value) {
        case ":direct":
          testString = await vscode.window.showInputBox({
            prompt: "Enter the test cases.",
            validateInput: (s: string): string | undefined =>
              s && s.trim() ? undefined : "Test case must not be empty.",
            placeHolder: "Example: [1,2,3]\\n4",
            ignoreFocusOut: true,
          });
          if (testString) {
            tsd.filePath = filePath;
            tsd.testString = this.parseTestString(testString);
            tsd.allCase = false;
            tsd.type = TestSolutionType.Type_1;
            result = await executeService.testSolution(tsd.filePath, tsd.testString, tsd.allCase);
            tsd.result = result;
          }
          break;
        case ":file":
          testFile = await this.showFileSelectDialog(filePath);
          if (testFile && testFile.length) {
            const input: string = (await fse.readFile(testFile[0].fsPath, "utf-8")).trim();
            if (input) {
              tsd.filePath = filePath;
              tsd.testString = this.parseTestString(input.replace(/\r?\n/g, "\\n"));
              tsd.allCase = false;
              result = await executeService.testSolution(tsd.filePath, tsd.testString, tsd.allCase);
              tsd.result = result;
              tsd.type = TestSolutionType.Type_2;
            } else {
              vscode.window.showErrorMessage("The selected test file must not be empty.");
            }
          }
          break;
        default:
          break;
      }
      if (!result) {
        return;
      }
      // submissionService.show(result);
      // eventService.emit("submit", submissionService.getSubmitEvent());
      eventService.emit("testSolutionResult", result, tsd);
    } catch (error) {
      await promptForOpenOutputChannel("提交测试出错了. 请查看控制台信息~", OutPutType.error);
    }
  }
  /**
   * "Show a file selection dialog, and return the selected file's URI."
   *
   * The function is async, so it returns a promise
   * @param {string} [fsPath] - The path of the file that is currently open in the editor.
   * @returns An array of file URIs or undefined.
   */
  public async showFileSelectDialog(fsPath?: string): Promise<vscode.Uri[] | undefined> {
    const defaultUri: vscode.Uri | undefined = getBelongingWorkspaceFolderUri(fsPath);
    const options: vscode.OpenDialogOptions = {
      defaultUri,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Select",
    };
    return await vscode.window.showOpenDialog(options);
  }

  /**
   * It gets the active file path, and then calls the executeService.testSolution function to test the
   * solution
   * @param [uri] - The path of the file to be submitted. If it is not passed, the currently active file
   * is submitted.
   * @param {boolean} [allCase] - Whether to submit all cases.
   * @returns a promise that resolves to void.
   */
  public async testCaseDef(uri?: vscode.Uri, allCase?: boolean): Promise<void> {
    try {
      let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
      if (sbp.getStatus() === UserStatus.SignedOut) {
        return;
      }

      const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
      if (!filePath) {
        return;
      }

      let tsd: ITestSolutionData = Object.assign({}, defaultTestSolutionData, {});
      tsd.filePath = filePath;
      tsd.testString = undefined;
      tsd.allCase = allCase || false;
      tsd.type = TestSolutionType.Type_3;
      let result: string | undefined = await executeService.testSolution(tsd.filePath, tsd.testString, tsd.allCase);
      tsd.result = result;
      if (!result) {
        return;
      }
      // submissionService.show(result);
      // eventService.emit("submit", submissionService.getSubmitEvent());
      eventService.emit("testSolutionResult", result, tsd);
    } catch (error) {
      await promptForOpenOutputChannel("提交测试出错了. 请查看控制台信息~", OutPutType.error);
    }
  }

  // 提交测试用例
  /**
   * It takes the current file, and sends it to the server to be tested
   * @param [uri] - The file path of the file to be submitted. If it is not passed, the currently active
   * file is submitted.
   */
  public async reTestSolution(uri?: vscode.Uri): Promise<void> {
    try {
      let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
      if (sbp.getStatus() === UserStatus.SignedOut) {
        return;
      }

      const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
      if (!filePath) {
        return;
      }
      const fileContent: Buffer = fs.readFileSync(filePath);
      const meta: ProblemMeta | null = fileMeta(fileContent.toString());

      let qid: string | undefined = undefined;
      if (meta?.id != undefined) {
        qid = this.getQidByFid(meta?.id);
      }

      if (qid == undefined) {
        return;
      }

      let tsd: ITestSolutionData | undefined = submissionService.getTSDByQid(qid);
      if (tsd == undefined) {
        return;
      }

      let result: string | undefined = await executeService.testSolution(tsd.filePath, tsd.testString, tsd.allCase);
      if (!result) {
        return;
      }
      // submissionService.show(result);
      // eventService.emit("submit", submissionService.getSubmitEvent());
      eventService.emit("testSolutionResult", result, tsd);
    } catch (error) {
      await promptForOpenOutputChannel("提交测试出错了. 请查看控制台信息~", OutPutType.error);
    }
  }

  /**
   * It gets the active file path, then calls the executeService.testSolution function to test the
   * solution
   * @param [uri] - The file path of the file to be submitted. If it is not passed in, the currently
   * active file is submitted.
   * @param {string} [testcase] - The test case to be tested. If it is not specified, the test case will
   * be randomly selected.
   * @returns a promise that resolves to void.
   */
  public async tesCaseArea(uri?: vscode.Uri, testcase?: string): Promise<void> {
    try {
      let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
      if (sbp.getStatus() === UserStatus.SignedOut) {
        return;
      }

      const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
      if (!filePath) {
        return;
      }

      let tsd: ITestSolutionData = Object.assign({}, defaultTestSolutionData, {});
      tsd.filePath = filePath;
      tsd.testString = testcase;
      tsd.allCase = false;
      tsd.type = TestSolutionType.Type_4;
      let result: string | undefined = await executeService.testSolution(tsd.filePath, tsd.testString, tsd.allCase);
      tsd.result = result;
      if (!result) {
        return;
      }
      // submissionService.show(result);
      // eventService.emit("submit", submissionService.getSubmitEvent());
      eventService.emit("testSolutionResult", result, tsd);
    } catch (error) {
      await promptForOpenOutputChannel("提交测试出错了. 请查看控制台信息~", OutPutType.error);
    }
  }

  /**
   * If you're on Windows, and you're using cmd.exe, then you need to escape double quotes with
   * backslashes. Otherwise, you don't
   * @param {string} test - The test string to be parsed.
   * @returns a string.
   */
  public parseTestString(test: string): string {
    if (systemUtils.useWsl() || !systemUtils.isWindows()) {
      if (systemUtils.useVscodeNode()) {
        return `${test}`;
      }
      return `'${test}'`;
    }

    if (usingCmd()) {
      // 一般需要走进这里, 除非改了 环境变量ComSpec的值
      if (systemUtils.useVscodeNode()) {
        //eslint-disable-next-line
        return `${test.replace(/"/g, '"')}`;
      }
      return `"${test.replace(/"/g, '\\"')}"`;
    } else {
      if (systemUtils.useVscodeNode()) {
        //eslint-disable-next-line
        return `${test.replace(/"/g, '"')}`;
      }
      return `'${test.replace(/"/g, '\\"')}'`;
    }
  }

  /**
   * It switches the endpoint of LeetCode, and then signs out and signs in again
   * @returns a promise that resolves to a void.
   */
  public async switchEndpoint(): Promise<void> {
    const isCnEnabled: boolean = getLeetCodeEndpoint() === Endpoint.LeetCodeCN;
    const picks: Array<IQuickItemEx<string>> = [];
    picks.push(
      {
        label: `${isCnEnabled ? "" : "$(check) "}LeetCode`,
        description: "leetcode.com",
        detail: `Enable LeetCode.com US`,
        value: Endpoint.LeetCode,
      },
      {
        label: `${isCnEnabled ? "$(check) " : ""}力扣`,
        description: "leetcode.cn",
        detail: `启用中国版 LeetCode.cn`,
        value: Endpoint.LeetCodeCN,
      }
    );
    const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks);
    if (!choice || choice.value === getLeetCodeEndpoint()) {
      return;
    }
    const leetCodeConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("leetcode-problem-rating");
    try {
      const endpoint: string = choice.value;
      await executeService.switchEndpoint(endpoint);
      await leetCodeConfig.update("endpoint", endpoint, true /* UserSetting */);
      vscode.window.showInformationMessage(`Switched the endpoint to ${endpoint}`);
    } catch (error) {
      await promptForOpenOutputChannel("切换站点出错. 请查看控制台信息~", OutPutType.error);
    }

    try {
      await vscode.commands.executeCommand("lcpr.signout");
      await executeService.deleteCache();
      await promptForSignIn();
    } catch (error) {
      await promptForOpenOutputChannel("登录失败. 请查看控制台信息~", OutPutType.error);
    }
  }

  /**
   * It shows a quick pick menu with the available sorting strategies, and if the user selects one, it
   * updates the sorting strategy and refreshes the tree view
   * @returns A promise that resolves to a void.
   */
  public async switchSortingStrategy(): Promise<void> {
    const currentStrategy: SortingStrategy = getSortingStrategy();
    const picks: Array<IQuickItemEx<string>> = [];
    picks.push(
      ...SORT_ORDER.map((s: SortingStrategy) => {
        return {
          label: `${currentStrategy === s ? "$(check)" : "    "} ${s}`,
          value: s,
        };
      })
    );

    const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks);
    if (!choice || choice.value === currentStrategy) {
      return;
    }

    await updateSortingStrategy(choice.value, true);
    await treeDataService.refresh();
    await bricksDataService.refresh();
  }

  /**
   * It adds a node to the user's favorites
   * @param {NodeModel} node - NodeModel
   */
  public async addFavorite(node: NodeModel): Promise<void> {
    try {
      await executeService.toggleFavorite(node, true);
      await treeDataService.refresh();
      await bricksDataService.refresh();
      if (isStarShortcut()) {
        BABA.sendNotification(BabaStr.FileButton_refresh);
      }
    } catch (error) {
      await promptForOpenOutputChannel("添加喜欢题目失败. 请查看控制台信息~", OutPutType.error);
    }
  }

  /**
   * It removes a node from the user's favorites
   * @param {NodeModel} node - The node that is currently selected in the tree.
   */
  public async removeFavorite(node: NodeModel): Promise<void> {
    try {
      await executeService.toggleFavorite(node, false);
      await treeDataService.refresh();
      await bricksDataService.refresh();
      if (isStarShortcut()) {
        BABA.sendNotification(BabaStr.FileButton_refresh);
      }
    } catch (error) {
      await promptForOpenOutputChannel("移除喜欢题目失败. 请查看控制台信息~", OutPutType.error);
    }
  }

  /**
   * It returns a list of problems
   * @returns An array of problems.
   */
  public async getAllProblems(): Promise<IProblem[]> {
    try {
      let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
      if (sbp.getStatus() === UserStatus.SignedOut) {
        return [];
      }

      const showLockedFlag: boolean = isShowLocked();
      const useEndpointTranslation: boolean = isUseEndpointTranslation();
      const result: string = await executeService.getAllProblems(showLockedFlag, useEndpointTranslation);
      let all_problem_info = JSON.parse(result);
      if (!showLockedFlag) {
        all_problem_info = all_problem_info.filter((p) => !p.locked);
      }
      const problems: IProblem[] = [];
      const AllScoreData = treeDataService.getScoreData();
      // 增加直接在线获取分数数据
      const AllScoreDataOnline = await treeDataService.getScoreDataOnline();
      for (const p of all_problem_info) {
        problems.push({
          id: p.fid,
          qid: p.id,
          isFavorite: p.starred,
          locked: p.locked,
          state: this.parseProblemState(p.state),
          name: p.name,
          cn_name: p.cn_name,
          en_name: p.en_name,
          difficulty: p.level,
          passRate: p.percent,
          companies: p.companies || [],
          tags: treeDataService.getTagsData(p.fid),
          scoreData: AllScoreDataOnline.get(p.fid) || AllScoreData.get(p.fid),
          isSearchResult: false,
          input: "",
          rootNodeSortId: RootNodeSort.ZERO,
          todayData: undefined,
        });
      }
      return problems.reverse();
    } catch (error) {
      await promptForOpenOutputChannel("获取题目失败. 请查看控制台信息~", OutPutType.error);
      return [];
    }
  }

  public parseProblemState(stateOutput: string): ProblemState {
    if (!stateOutput) {
      return ProblemState.Unknown;
    }
    switch (stateOutput.trim()) {
      case "v":
      case "✔":
      case "√":
      case "ac":
        return ProblemState.AC;
      case "X":
      case "✘":
      case "×":
      case "notac":
        return ProblemState.NotAC;
      default:
        return ProblemState.Unknown;
    }
  }

  public async setDefaultLanguage(): Promise<void> {
    await setDefaultLanguage();
  }

  public async searchProblem(): Promise<void> {
    const picks: Array<IQuickItemEx<string>> = [];
    picks.push(
      {
        label: `题目id查询`,
        detail: `通过题目id查询`,
        value: `byid`,
      },
      {
        label: `分数范围查询`,
        detail: `例如 1500-1600`,
        value: `range`,
      },
      {
        label: `周赛期数查询`,
        detail: `周赛期数查询`,
        value: `contest`,
      }
      // {
      //   label: `测试api`,
      //   detail: `测试api`,
      //   value: `testapi`,
      // }
    );
    const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks, {
      title: "选择查询选项",
    });
    if (!choice) {
      return;
    }

    if (!BABA.getProxy(BabaStr.StatusBarProxy).getUser() && choice.value != "testapi") {
      promptForSignIn();
      return;
    }

    if (choice.value == "byid") {
      await this.searchProblemByID();
    } else if (choice.value == "range") {
      await this.searchScoreRange();
    } else if (choice.value == "contest") {
      await this.searchContest();
    } else if (choice.value == "today") {
      await this.searchToday();
    } else if (choice.value == "userContest") {
      await this.searchUserContest();
    } else if (choice.value == "testapi") {
      await this.testapi();
    }
  }

  public async getHelp(input: NodeModel | vscode.Uri): Promise<void> {
    let problemInput: string | undefined;
    if (input instanceof NodeModel) {
      // Triggerred from explorer
      problemInput = input.qid;
    } else if (input instanceof vscode.Uri) {
      // Triggerred from Code Lens/context menu
      if (systemUtils.useVscodeNode()) {
        problemInput = `${input.fsPath}`;
      } else {
        problemInput = `"${input.fsPath}"`;
        if (systemUtils.useWsl()) {
          problemInput = await systemUtils.toWslPath(input.fsPath);
        }
      }
    } else if (!input) {
      // Triggerred from command
      problemInput = await getTextEditorFilePathByUri();
    }

    if (!problemInput) {
      vscode.window.showErrorMessage("Invalid input to fetch the solution data.");
      return;
    }

    const language: string | undefined = await fetchProblemLanguage();
    if (!language) {
      return;
    }

    const picks: Array<IQuickItemEx<string>> = [];
    picks.push(
      {
        label: "获取中文站题解",
        description: "",
        detail: "",
        value: "cn",
      },
      {
        label: "获取英文站题解",
        description: "",
        detail: "",
        value: "en",
      }
    );
    const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks);
    if (!choice) {
      return;
    }

    try {
      const needTranslation: boolean = isUseEndpointTranslation();
      const solution: string = await executeService.getHelp(
        problemInput,
        language,
        needTranslation,
        choice.value == "cn"
      );
      solutionService.show(solution);
    } catch (error) {
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
      await promptForOpenOutputChannel("Failed to fetch the top voted solution. 请查看控制台信息~", OutPutType.error);
    }
  }

  public async testapi(): Promise<void> {
    try {
      // let so = {};
      // const solution: string = JSON.stringify(so);
      // solutionService.show(solution);
      // debugContorller.try_get_diy_param();
    } catch (error) {
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
      await promptForOpenOutputChannel("Failed to fetch today question. 请查看控制台信息~", OutPutType.error);
    }
  }

  public async searchProblemByID(): Promise<void> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      promptForSignIn();
      return;
    }
    const choice: IQuickItemEx<IProblem> | undefined = await vscode.window.showQuickPick(
      this.parseProblemsToPicks(this.getAllProblems()),
      {
        matchOnDetail: true,
        matchOnDescription: true,
        placeHolder: "Select one problem",
      }
    );
    if (!choice) {
      return;
    }
    await this.showProblemInternal(choice.value);
  }

  public async showProblem(node?: NodeModel): Promise<void> {
    if (!node) {
      return;
    }
    await this.showProblemInternal(node);
  }

  public async pickOne(): Promise<void> {
    const picks: Array<IQuickItemEx<string>> = [];

    let last_pick = await groupDao.getPickOneTags();

    let last_tag_set: Set<string> = new Set<string>();
    last_pick.forEach((tag_name) => {
      last_tag_set.add(tag_name);
    });

    for (const tag of this.tagSet.values()) {
      let pick_item: IQuickItemEx<string> = {
        label: tag,
        detail: "",
        value: tag,
      };
      if (last_tag_set.has(tag)) {
        pick_item.picked = true;
      }

      picks.push(pick_item);
    }

    const choice: Array<IQuickItemEx<string>> | undefined = await window.showQuickPick(picks, {
      title: "指定Tag类型",
      matchOnDescription: false,
      matchOnDetail: false,
      placeHolder: "指定Tag类型",
      canPickMany: true,
    });
    if (!choice) {
      return;
    }

    // 写入选择
    let cur_tag_set: Set<string> = new Set<string>();
    choice.forEach((element) => {
      cur_tag_set.add(element.value);
    });

    const problems: IProblem[] = await this.getAllProblems();
    let randomProblem: IProblem;

    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    const user_score = sbp.getUserContestScore();
    if (user_score > 0) {
      let min_score: number = getPickOneByRankRangeMin();
      let max_score: number = getPickOneByRankRangeMax();
      let temp_problems: IProblem[] = [];
      const need_min = user_score + min_score;
      const need_max = user_score + max_score;
      problems.forEach((element) => {
        if (element.scoreData?.Rating) {
          if (element.scoreData.Rating >= need_min && element.scoreData.Rating <= need_max) {
            for (const q_tag of element.tags) {
              if (cur_tag_set.has(q_tag)) {
                temp_problems.push(element);
              }
            }
          }
        }
      });
      randomProblem = temp_problems[Math.floor(Math.random() * temp_problems.length)];
    } else {
      randomProblem = problems[Math.floor(Math.random() * problems.length)];
    }
    if (randomProblem) {
      await this.showProblemInternal(randomProblem);
    }

    // 写入
    let new_pick_one_tags: Array<string> = [];
    for (const new_tag of cur_tag_set) {
      new_pick_one_tags.push(new_tag);
    }
    await groupDao.setPickOneTags(new_pick_one_tags);
  }

  public async showProblemInternal(node: IProblem): Promise<void> {
    try {
      const language: string | undefined = await fetchProblemLanguage();
      if (!language) {
        return;
      }

      const leetCodeConfig: vscode.WorkspaceConfiguration =
        vscode.workspace.getConfiguration("leetcode-problem-rating");
      const workspaceFolder: string = await selectWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const fileFolder: string = leetCodeConfig
        .get<string>(`filePath.${language}.folder`, leetCodeConfig.get<string>(`filePath.default.folder`, ""))
        .trim();
      const fileName: string = leetCodeConfig
        .get<string>(
          `filePath.${language}.filename`,
          leetCodeConfig.get<string>(`filePath.default.filename`) || genFileName(node, language)
        )
        .trim();

      let finalPath: string = path.join(workspaceFolder, fileFolder, fileName);

      if (finalPath) {
        finalPath = await this.resolveRelativePath(finalPath, node, language);
        if (!finalPath) {
          BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine("Showing problem canceled by user.");
          return;
        }
      }

      finalPath = systemUtils.useWsl() ? await systemUtils.toWinPath(finalPath) : finalPath;

      const descriptionConfig: IDescriptionConfiguration = getDescriptionConfiguration();
      const needTranslation: boolean = isUseEndpointTranslation();

      let show_code = await executeService.showProblem(
        node,
        language,
        finalPath,
        descriptionConfig.showInComment,
        needTranslation
      );
      if (show_code == 100) {
        const promises: any[] = [
          vscode.window
            .showTextDocument(vscode.Uri.file(finalPath), {
              preview: false,
              viewColumn: vscode.ViewColumn.One,
            })
            .then(
              (editor) => {
                eventService.emit("showProblemFinishOpen", node, editor);
              },
              (error) => {
                eventService.emit("showProblemFinishError", node, error);
              }
            ),
          promptHintMessage(
            "hint.commentDescription",
            'You can config how to show the problem description through "leetcode-problem-rating.showDescription".',
            "Open settings",
            (): Promise<any> => openSettingsEditor("leetcode-problem-rating.showDescription")
          ),
        ];
        if (descriptionConfig.showInWebview) {
          promises.push(this.showDescriptionView(node));
        }
        promises.push(
          new Promise(async (resolve, _) => {
            await eventService.emit("showProblemFinish", node);
            resolve(1);
          })
        );

        await Promise.all(promises);
      }
    } catch (error) {
      await promptForOpenOutputChannel(`${error} 请查看控制台信息~`, OutPutType.error);
    }
  }

  public async showDescriptionView(node: IProblem): Promise<void> {
    return this.previewProblem(node, enableSideMode());
  }

  public async previewProblem(input: IProblem | Uri, isSideMode: boolean = false): Promise<void> {
    let node: IProblem;
    if (input instanceof Uri) {
      const activeFilePath: string = input.fsPath;
      const id: string = await getNodeIdFromFile(activeFilePath);
      if (!id) {
        window.showErrorMessage(`Failed to resolve the problem id from file: ${activeFilePath}.`);
        return;
      }
      const cachedNode: IProblem | undefined = treeViewController.getNodeById(id);
      if (!cachedNode) {
        window.showErrorMessage(`Failed to resolve the problem with id: ${id}.`);
        return;
      }
      node = cachedNode;
      // Move the preview page aside if it's triggered from Code Lens
      isSideMode = true;
    } else {
      node = input;
    }
    const needTranslation: boolean = isUseEndpointTranslation();
    const descString: string = await executeService.getDescription(node.qid, needTranslation);

    let successResult;
    try {
      successResult = JSON.parse(descString);
    } catch (e) {
      successResult = {};
    }
    if (successResult.code == 100) {
      previewService.show(JSON.stringify(successResult.msg), node, isSideMode);
    } else {
      await promptForOpenOutputChannel(`${descString} 请查看控制台信息~`, OutPutType.error);
    }
  }

  public async searchScoreRange(): Promise<void> {
    const twoFactor: string | undefined = await vscode.window.showInputBox({
      prompt: "输入分数范围 低分-高分 例如: 1500-1600",
      ignoreFocusOut: true,
      validateInput: (s: string): string | undefined => (s && s.trim() ? undefined : "The input must not be empty"),
    });

    // vscode.window.showErrorMessage(twoFactor || "输入错误");
    const tt = Object.assign({}, SearchNode, {
      value: twoFactor,
      type: SearchSetType.ScoreRange,
      time: Math.floor(Date.now() / 1000),
    });
    treeViewController.insertSearchSet(tt);
    await treeDataService.refresh();
    await bricksDataService.refresh();
  }

  public async searchContest(): Promise<void> {
    const twoFactor: string | undefined = await vscode.window.showInputBox({
      prompt: "单期数 例如: 300 或者 输入期数范围 低期数-高期数 例如: 303-306",
      ignoreFocusOut: true,
      validateInput: (s: string): string | undefined => (s && s.trim() ? undefined : "The input must not be empty"),
    });

    // vscode.window.showErrorMessage(twoFactor || "输入错误");
    const tt = Object.assign({}, SearchNode, {
      value: twoFactor,
      type: SearchSetType.Context,
      time: Math.floor(Date.now() / 1000),
    });
    treeViewController.insertSearchSet(tt);
    await treeDataService.refresh();
    await bricksDataService.refresh();
  }

  public async searchUserContest(): Promise<void> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      promptForSignIn();
      return;
    }
    try {
      const needTranslation: boolean = isUseEndpointTranslation();
      const solution: string = await executeService.getUserContest(needTranslation, sbp.getUser() || "");
      const query_result = JSON.parse(solution);
      const tt: userContestRanKingBase = Object.assign({}, userContestRankingObj, query_result.userContestRanking);
      eventService.emit("searchUserContest", tt);
    } catch (error) {
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
      await promptForOpenOutputChannel("Failed to fetch today question. 请查看控制台信息~", OutPutType.error);
    }
  }
  public async searchToday(): Promise<void> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      promptForSignIn();
      return;
    }
    try {
      const needTranslation: boolean = isUseEndpointTranslation();
      const solution: string = await executeService.getTodayQuestion(needTranslation);
      const query_result = JSON.parse(solution);
      // const titleSlug: string = query_result.titleSlug
      // const questionId: string = query_result.questionId
      const fid: string = query_result.fid;
      if (fid) {
        const tt = Object.assign({}, SearchNode, {
          value: fid,
          type: SearchSetType.Day,
          time: Math.floor(Date.now() / 1000),
          todayData: query_result,
        });
        treeViewController.insertSearchSet(tt);
        await treeDataService.refresh();
        await bricksDataService.refresh();
      }
    } catch (error) {
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
      await promptForOpenOutputChannel("Failed to fetch today question. 请查看控制台信息~", OutPutType.error);
    }
  }

  public async parseProblemsToPicks(p: Promise<IProblem[]>): Promise<Array<IQuickItemEx<IProblem>>> {
    return new Promise(async (resolve: (res: Array<IQuickItemEx<IProblem>>) => void): Promise<void> => {
      const picks: Array<IQuickItemEx<IProblem>> = (await p).map((problem: IProblem) =>
        Object.assign(
          {},
          {
            label: `${this.parseProblemDecorator(problem.state, problem.locked)}${problem.id}.${problem.name}`,
            description: `QID:${problem.qid}`,
            detail:
              ((problem.scoreData?.score || "0") > "0" ? "score: " + problem.scoreData?.score + " , " : "") +
              `AC rate: ${problem.passRate}, Difficulty: ${problem.difficulty}`,
            value: problem,
          }
        )
      );
      resolve(picks);
    });
  }

  public parseProblemDecorator(state: ProblemState, locked: boolean): string {
    switch (state) {
      case ProblemState.AC:
        return "$(check) ";
      case ProblemState.NotAC:
        return "$(x) ";
      default:
        return locked ? "$(lock) " : "";
    }
  }

  public async resolveRelativePath(relativePath: string, node: IProblem, selectedLanguage: string): Promise<string> {
    let tag: string = "";
    if (/\$\{tag\}/i.test(relativePath)) {
      tag = (await this.resolveTagForProblem(node)) || "";
    }

    let company: string = "";
    if (/\$\{company\}/i.test(relativePath)) {
      company = (await this.resolveCompanyForProblem(node)) || "";
    }

    let errorMsg: string;
    return relativePath.replace(/\$\{(.*?)\}/g, (_substring: string, ...args: string[]) => {
      const placeholder: string = args[0].toLowerCase().trim();
      switch (placeholder) {
        case "id":
          return node.id;
        case "cnname":
        case "cn_name":
          return node.cn_name || node.name;
        case "name":
          return node.en_name || node.name;
        case "camelcasename":
          return lodash.camelCase(node.en_name || node.name);
        case "pascalcasename":
          return lodash.upperFirst(lodash.camelCase(node.en_name || node.name));
        case "kebabcasename":
        case "kebab-case-name":
          return lodash.kebabCase(node.en_name || node.name);
        case "snakecasename":
        case "snake_case_name":
          return lodash.snakeCase(node.en_name || node.name);
        case "ext":
          return genFileExt(selectedLanguage);
        case "language":
          return selectedLanguage;
        case "difficulty":
          return node.difficulty.toLocaleLowerCase();
        case "tag":
          return tag;
        case "company":
          return company;
        case "yyyymmdd":
          return getyyyymmdd(undefined);
        case "timestamp":
          return getDayNowStr();
        default:
          errorMsg = `The config '${placeholder}' is not supported.`;
          BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(errorMsg);
          throw new Error(errorMsg);
      }
    });
  }

  public async resolveTagForProblem(problem: IProblem): Promise<string | undefined> {
    let path_en_tags = treeDataService.getTagsDataEn(problem.id);
    if (path_en_tags.length === 1) {
      return path_en_tags[0];
    }
    return await vscode.window.showQuickPick(path_en_tags, {
      matchOnDetail: true,
      placeHolder: "Multiple tags available, please select one",
      ignoreFocusOut: true,
    });
  }

  public async resolveCompanyForProblem(problem: IProblem): Promise<string | undefined> {
    if (problem.companies.length === 1) {
      return problem.companies[0];
    }
    return await vscode.window.showQuickPick(problem.companies, {
      matchOnDetail: true,
      placeHolder: "Multiple tags available, please select one",
      ignoreFocusOut: true,
    });
  }

  public insertSearchSet(tt: ISearchSet) {
    this.searchSet.set(tt.value, tt);
  }
  public clearUserScore() {
    this.waitUserContest = false;
    this.waitTodayQuestion = false;
    this.searchSet = new Map<string, ISearchSet>();
  }

  public checkSubmit(e: ISubmitEvent) {
    if (e.sub_type == "submit" && e.accepted) {
      const day_start = systemUtils.getDayStart(); //获取当天零点的时间
      const day_end = systemUtils.getDayEnd(); //获取当天23:59:59的时间
      let need_get_today: boolean = false;
      this.searchSet.forEach((element) => {
        if (element.type == SearchSetType.Day) {
          if (day_start <= element.time && element.time <= day_end) {
            if (e.fid == element.value) {
              need_get_today = true;
            }
          }
        }
      });
      if (need_get_today) {
        this.searchToday();
      }
    }
  }

  public async refreshCheck(): Promise<void> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      return;
    }
    const day_start = systemUtils.getDayStart(); //获取当天零点的时间
    const day_end = systemUtils.getDayEnd(); //获取当天23:59:59的时间
    let need_get_today: boolean = true;
    this.searchSet.forEach((element) => {
      if (element.type == SearchSetType.Day) {
        if (day_start <= element.time && element.time <= day_end) {
          need_get_today = false;
        } else {
          this.waitTodayQuestion = false;
        }
      }
    });
    if (need_get_today && !this.waitTodayQuestion) {
      this.waitTodayQuestion = true;
      await this.searchToday();
    }

    let user_score = sbp.getUserContestScore();
    if (!user_score && !this.waitUserContest) {
      this.waitUserContest = true;
      await this.searchUserContest();
    }
  }

  public async refreshCache(): Promise<void> {
    const temp_searchSet: Map<string, ISearchSet> = this.searchSet;
    const temp_waitTodayQuestion: boolean = this.waitTodayQuestion;
    const temp_waitUserContest: boolean = this.waitUserContest;
    this.clearCache();

    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);

    let user_score = sbp.getUserContestScore();
    for (const problem of await this.getAllProblems()) {
      this.explorerNodeMap.set(problem.id, new NodeModel(problem, true, user_score));
      this.fidToQid.set(problem.id, problem.qid.toString());
      this.qidToFid.set(problem.qid.toString(), problem.id);

      for (const company of problem.companies) {
        this.companySet.add(company);
      }
      for (const tag of problem.tags) {
        this.tagSet.add(tag);
      }
    }
    this.searchSet = temp_searchSet;
    this.waitTodayQuestion = temp_waitTodayQuestion;
    this.waitUserContest = temp_waitUserContest;
    eventService.emit("explorerNodeMapSet");
  }

  public getRootNodes(): NodeModel[] {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    let user_score = sbp.getUserContestScore();
    const baseNode: NodeModel[] = [
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: Category.All,
          name: Category.All,
          rootNodeSortId: RootNodeSort.All,
        }),
        false
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: Category.Difficulty,
          name: Category.Difficulty,
          rootNodeSortId: RootNodeSort.Difficulty,
        }),
        false
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: Category.Tag,
          name: Category.Tag,
          rootNodeSortId: RootNodeSort.Tag,
        }),
        false
      ),
      // new NodeModel(Object.assign({}, defaultProblem, {
      //     id: Category.Company,
      //     name: Category.Company,
      //     rootNodeSortId: RootNodeSort.Company,
      // }), false),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: Category.Favorite,
          name: Category.Favorite,
          rootNodeSortId: RootNodeSort.Favorite,
        }),
        false
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: Category.Score,
          name: Category.Score,
          rootNodeSortId: RootNodeSort.Score,
        }),
        false,
        user_score
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: Category.Choice,
          name: Category.Choice,
          rootNodeSortId: RootNodeSort.Choice,
        }),
        false
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: Category.Contest,
          name: Category.Contest,
          rootNodeSortId: RootNodeSort.Context,
        }),
        false
      ),
    ];
    this.searchSet.forEach((element) => {
      if (element.type == SearchSetType.Day) {
        const curDate = new Date(element.time * 1000);
        baseNode.push(
          new NodeModel(
            Object.assign({}, defaultProblem, {
              id: element.type,
              name:
                "[" +
                curDate.getFullYear() +
                "-" +
                (curDate.getMonth() + 1) +
                "-" +
                curDate.getDate() +
                "]" +
                SearchSetTypeName[SearchSetType.Day],
              input: element.value,
              isSearchResult: true,
              rootNodeSortId: RootNodeSort[element.type],
              todayData: element.todayData,
            }),
            false
          )
        );
      } else {
        baseNode.push(
          new NodeModel(
            Object.assign({}, defaultProblem, {
              id: element.type,
              name: SearchSetTypeName[element.type] + element.value,
              input: element.value,
              isSearchResult: true,
              rootNodeSortId: RootNodeSort[element.type],
            }),
            false
          )
        );
      }
    });
    baseNode.sort(function (a: NodeModel, b: NodeModel): number {
      if (a.rootNodeSortId < b.rootNodeSortId) {
        return -1;
      } else if (a.rootNodeSortId > b.rootNodeSortId) {
        return 1;
      }
      return 0;
    });
    return baseNode;
  }

  public getScoreRangeNodes(rank_range: string): NodeModel[] {
    const sorceNode: NodeModel[] = [];
    const rank_r: Array<string> = rank_range.split("-");
    let rank_a = Number(rank_r[0]);
    let rank_b = Number(rank_r[1]);
    if (rank_a > 0 && rank_b > 0) {
      if (rank_a > rank_b) {
        const rank_c: number = rank_a;
        rank_a = rank_b;
        rank_b = rank_c;
      }

      this.explorerNodeMap.forEach((element) => {
        if (!this.canShow(element)) {
          return;
        }
        if (rank_a <= Number(element.score) && Number(element.score) <= rank_b) {
          sorceNode.push(element);
        }
      });
    }
    return this.applySortingStrategy(sorceNode);
  }

  public canShow(element: NodeModel) {
    if (isHideSolvedProblem() && element.state === ProblemState.AC) {
      return false;
    }
    if (isHideScoreProblem(element, element.user_score)) {
      return false;
    }
    return true;
  }

  public getContextNodes(rank_range: string): NodeModel[] {
    const sorceNode: NodeModel[] = [];
    const rank_r: Array<string> = rank_range.split("-");
    let rank_a = Number(rank_r[0]);
    let rank_b = Number(rank_r[1]);
    if (rank_a > 0) {
      this.explorerNodeMap.forEach((element) => {
        if (!this.canShow(element)) {
          return;
        }
        const slu = element.ContestSlug;
        const slu_arr: Array<string> = slu.split("-");
        const slu_id = Number(slu_arr[slu_arr.length - 1]);
        if (rank_b > 0 && rank_a <= slu_id && slu_id <= rank_b) {
          sorceNode.push(element);
        } else if (rank_a == slu_id) {
          sorceNode.push(element);
        }
      });
    }
    return this.applySortingStrategy(sorceNode);
  }
  public getDayNodes(element: NodeModel | undefined): NodeModel[] {
    const rank_range: string = element?.input || "";
    const sorceNode: NodeModel[] = [];
    if (rank_range) {
      this.explorerNodeMap.forEach((new_node) => {
        if (new_node.id == rank_range) {
          new_node.todayData = element?.todayData;
          sorceNode.push(new_node);
        }
      });
    }
    return this.applySortingStrategy(sorceNode);
  }

  public getAllNodes(): NodeModel[] {
    return this.applySortingStrategy(Array.from(this.explorerNodeMap.values()).filter((p) => this.canShow(p)));
  }

  public getAllDifficultyNodes(): NodeModel[] {
    const res: NodeModel[] = [];
    res.push(
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: `${Category.Difficulty}.Easy`,
          name: "Easy",
        }),
        false
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: `${Category.Difficulty}.Medium`,
          name: "Medium",
        }),
        false
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: `${Category.Difficulty}.Hard`,
          name: "Hard",
        }),
        false
      )
    );
    this.sortSubCategoryNodes(res, Category.Difficulty);
    return res;
  }

  public getAllScoreNodes(user_score: number): NodeModel[] {
    const res: NodeModel[] = [];
    const score_array: Array<string> = [
      "3300",
      "3200",
      "3100",
      "3000",
      "2900",
      "2800",
      "2700",
      "2600",
      "2500",
      "2400",
      "2300",
      "2200",
      "2100",
      "2000",
      "1900",
      "1800",
      "1700",
      "1600",
      "1500",
      "1400",
      "1300",
      "1200",
      "1100",
    ];
    score_array.forEach((element) => {
      const temp_num = Number(element);
      const diff = Math.abs(temp_num - user_score);
      if (diff <= 200) {
        res.push(
          new NodeModel(
            Object.assign({}, defaultProblem, {
              id: `${Category.Score}.${element}`,
              name: `${element}`,
            }),
            false,
            user_score
          )
        );
      }
    });

    this.sortSubCategoryNodes(res, Category.Score);
    return res;
  }

  public getAllContestNodes(): NodeModel[] {
    const res: NodeModel[] = [];
    res.push(
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: `${Category.Contest}.Q1`,
          name: "Q1",
        }),
        false
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: `${Category.Contest}.Q2`,
          name: "Q2",
        }),
        false
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: `${Category.Contest}.Q3`,
          name: "Q3",
        }),
        false
      ),
      new NodeModel(
        Object.assign({}, defaultProblem, {
          id: `${Category.Contest}.Q4`,
          name: "Q4",
        }),
        false
      )
    );
    this.sortSubCategoryNodes(res, Category.Contest);
    return res;
  }
  public getAllChoiceNodes(): NodeModel[] {
    const res: NodeModel[] = [];

    const all_choice = treeDataService.getChoiceData();
    all_choice.forEach((element) => {
      res.push(
        new NodeModel(
          Object.assign({}, defaultProblem, {
            id: `${Category.Choice}.${element.id}`,
            name: `${element.name}`,
          }),
          false
        )
      );
    });
    this.sortSubCategoryNodes(res, Category.Choice);
    return res;
  }

  public getAllCompanyNodes(): NodeModel[] {
    const res: NodeModel[] = [];
    for (const company of this.companySet.values()) {
      res.push(
        new NodeModel(
          Object.assign({}, defaultProblem, {
            id: `${Category.Company}.${company}`,
            name: lodash.startCase(company),
          }),
          false
        )
      );
    }
    this.sortSubCategoryNodes(res, Category.Company);
    return res;
  }

  public getAllTagNodes(): NodeModel[] {
    const res: NodeModel[] = [];
    for (const tag of this.tagSet.values()) {
      res.push(
        new NodeModel(
          Object.assign({}, defaultProblem, {
            id: `${Category.Tag}.${tag}`,
            name: lodash.startCase(tag),
          }),
          false
        )
      );
    }
    this.sortSubCategoryNodes(res, Category.Tag);
    return res;
  }

  public getNodeById(id: string): NodeModel | undefined {
    return this.explorerNodeMap.get(id);
  }

  public getNodeByQid(qid: string): NodeModel | undefined {
    let new_qid = qid.toString();
    return this.getNodeById(this.qidToFid.get(new_qid) || "");
  }

  public getQidByFid(id: string) {
    return this.fidToQid.get(id);
  }

  public getFavoriteNodes(): NodeModel[] {
    const res: NodeModel[] = [];
    for (const node of this.explorerNodeMap.values()) {
      if (!this.canShow(node)) {
        continue;
      }
      if (node.isFavorite) {
        res.push(node);
      }
    }
    return this.applySortingStrategy(res);
  }

  public getChildrenNodesById(id: string): NodeModel[] {
    // The sub-category node's id is named as {Category.SubName}
    const metaInfo: string[] = id.split(".");
    const res: NodeModel[] = [];

    const choiceQuestionId: Map<number, boolean> = new Map<number, boolean>();
    if (metaInfo[0] == Category.Choice) {
      const all_choice = treeDataService.getChoiceData();
      all_choice.forEach((element) => {
        if (element.id == metaInfo[1]) {
          element.questions.forEach((kk) => {
            choiceQuestionId[kk] = true;
          });
          return;
        }
      });
    }

    for (const node of this.explorerNodeMap.values()) {
      if (!this.canShow(node)) {
        continue;
      }
      switch (metaInfo[0]) {
        case Category.Company:
          if (node.companies.indexOf(metaInfo[1]) >= 0) {
            res.push(node);
          }
          break;
        case Category.Difficulty:
          if (node.difficulty === metaInfo[1]) {
            res.push(node);
          }
          break;
        case Category.Tag:
          if (node.tags.indexOf(metaInfo[1]) >= 0) {
            res.push(node);
          }
          break;
        case Category.Score:
          if (node.score > "0") {
            const check_rank = toNumber(metaInfo[1]);
            const node_rank = toNumber(node.score);
            if (check_rank <= node_rank && node_rank < check_rank + 100) {
              res.push(node);
            }
          }
          break;
        case Category.Choice:
          if (choiceQuestionId[Number(node.qid)]) {
            res.push(node);
          }
          break;
        case Category.Contest:
          if (node.ProblemIndex == metaInfo[1]) {
            res.push(node);
          }
          break;
      }
    }
    return this.applySortingStrategy(res);
  }

  public clearCache(): void {
    this.explorerNodeMap.clear();
    this.companySet.clear();
    this.tagSet.clear();
    this.fidToQid.clear();
    this.qidToFid.clear();
  }

  public dispose(): void {
    this.configurationChangeListener.dispose();
    this.clearCache();
  }

  private sortSubCategoryNodes(subCategoryNodes: NodeModel[], category: Category): void {
    switch (category) {
      case Category.Difficulty:
        subCategoryNodes.sort((a: NodeModel, b: NodeModel): number => {
          function getValue(input: NodeModel): number {
            switch (input.name.toLowerCase()) {
              case "easy":
                return 1;
              case "medium":
                return 2;
              case "hard":
                return 3;
              default:
                return Number.MAX_SAFE_INTEGER;
            }
          }
          return getValue(a) - getValue(b);
        });
        break;
      case Category.Tag:
      case Category.Company:
        subCategoryNodes.sort((a: NodeModel, b: NodeModel): number => {
          if (a.name === "Unknown") {
            return 1;
          } else if (b.name === "Unknown") {
            return -1;
          } else {
            return Number(a.name > b.name) - Number(a.name < b.name);
          }
        });
        break;
      default:
        break;
    }
  }

  private applySortingStrategy(nodes: NodeModel[]): NodeModel[] {
    const strategy: SortingStrategy = getSortingStrategy();
    switch (strategy) {
      case SortingStrategy.AcceptanceRateAsc:
        return nodes.sort((x: NodeModel, y: NodeModel) => Number(x.acceptanceRate) - Number(y.acceptanceRate));
      case SortingStrategy.AcceptanceRateDesc:
        return nodes.sort((x: NodeModel, y: NodeModel) => Number(y.acceptanceRate) - Number(x.acceptanceRate));
      case SortingStrategy.ScoreAsc:
        return nodes.sort((x: NodeModel, y: NodeModel) => Number(x.score) - Number(y.score));
      case SortingStrategy.ScoreDesc:
        return nodes.sort((x: NodeModel, y: NodeModel) => Number(y.score) - Number(x.score));
      case SortingStrategy.IDDesc:
        return nodes.sort((x: NodeModel, y: NodeModel) => Number(y.id) - Number(x.id));
      default:
        return nodes;
    }
  }
}

export const treeViewController: TreeViewController = new TreeViewController();
