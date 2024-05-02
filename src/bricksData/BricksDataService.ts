/*
 * https://github.com/ccagml/leetcode-extension/src/service/BricksDataService.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Tuesday, November 22nd 2022, 10:42:49 am
 * Author: ccagml
 *
 * Copyright (c) 2022  ccagml . All rights reserved.
 */

import { TreeDataProvider, EventEmitter, Event, TreeItem, TreeItemCollapsibleState } from "vscode";
import { BricksNormalId, BricksType, ISubmitEvent } from "../model/ConstDefind";
import { bricksViewController } from "../controller/BricksViewController";
import { CreateTreeNodeModel, TreeNodeModel, TreeNodeType } from "../model/TreeNodeModel";
import { bricksDao } from "../dao/bricksDao";
import { groupDao } from "../dao/groupDao";
import { BABA, BABAMediator, BABAProxy, BabaStr, BaseCC } from "../BABA";

export class BricksDataService implements TreeDataProvider<TreeNodeModel> {
  private onDidChangeTreeDataEvent: EventEmitter<TreeNodeModel | undefined | null> = new EventEmitter<
    TreeNodeModel | undefined | null
  >();
  // tslint:disable-next-line:member-ordering
  public readonly onDidChangeTreeData: Event<any> = this.onDidChangeTreeDataEvent.event;

  public fire() {
    this.onDidChangeTreeDataEvent.fire(null);
  }

  public async initialize() {
    await bricksDao.init();
    await groupDao.init();
  }

  // 节点的内容
  public getTreeItem(element: TreeNodeModel): TreeItem | Thenable<TreeItem> {
    if (element.id === BricksNormalId.NotSignIn) {
      return {
        label: element.name,
        collapsibleState: element.collapsibleState, // 没有子节点
        command: {
          command: "lcpr.signin",
          title: "工头说你不是我们工地的人",
        },
      };
    }

    const result: TreeItem | Thenable<TreeItem> = {
      label: element.isProblem
        ? (element.score > "0" ? "[score:" + element.score + "]" : "") + `ID:${element.id}.${element.name} `
        : element.name,
      tooltip: this.getSubCategoryTooltip(element),
      collapsibleState: element.collapsibleState || TreeItemCollapsibleState.None,
      iconPath: this.parseIconPathFromProblemState(element),
      command: element.isProblem ? element.previewCommand : undefined,
      resourceUri: element.uri,
      contextValue: element.viewItem,
    };
    return result;
  }

  // 获取子节点信息
  public async getChildren(element?: TreeNodeModel | undefined): Promise<TreeNodeModel[] | null | undefined> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      return [
        CreateTreeNodeModel({
          id: BricksNormalId.NotSignIn,
          name: "工头说你不是我们工地的人",
          collapsibleState: TreeItemCollapsibleState.None,
        },
          TreeNodeType.BricksNotSignIn)
      ];
    }
    if (!element) {
      return await bricksViewController.getRootNodes();
    } else {

      if (element.nodeType == TreeNodeType.Bricks_TodaySubmit) {
        return await bricksViewController.getTodayNodes();
      }
      else if (element.nodeType == TreeNodeType.Bricks_NeedReview) {
        return await bricksViewController.getNeedReviewDayNodes();
      }
      else if (element.nodeType == TreeNodeType.Bricks_Diy) {
        return await bricksViewController.getDiyNode(element);
      }
      else if (element.nodeType == TreeNodeType.Bricks_NeedReview_Day) {
        return await bricksViewController.getNeedReviewNodesByDay(element);
      }
      return [];
    }
  }

  public async checkSubmit(e: ISubmitEvent) {
    if (e.sub_type == "submit" && e.accepted) {
      let qid: string = e.qid.toString();
      await bricksDao.addSubmitTimeByQid(qid);
      BABA.sendNotification(BabaStr.BricksData_submitAndAccepted);
    }
  }

  public async setBricksType(node: TreeNodeModel, type: BricksType) {
    let qid: string = node.qid.toString();
    await bricksDao.setReviewDayByQidAndType(qid, type);
    BABA.sendNotification(BabaStr.BricksData_setBricksTypeFinish);
  }

  private parseIconPathFromProblemState(element: TreeNodeModel): string {
    switch (element.state) {
      default:
        return "";
    }
  }

  private getSubCategoryTooltip(element: TreeNodeModel): string {
    // return '' unless it is a sub-category node
    if (element.id === "ROOT") {
      return "";
    }
    if (element.toolTip) {
      return element.toolTip;
    }
    return "";
  }

  // 创建一个新的分类
  public async newBrickGroup(name) {
    await groupDao.newBrickGroup(name);
  }
  // 删除一个分类
  public async removeBrickGroup(time) {
    await groupDao.removeBrickGroupByTime(time);
  }

  public async getAllGroup() {
    return await groupDao.getAllGroup();
  }
}

export const bricksDataService: BricksDataService = new BricksDataService();

export class BricksDataProxy extends BABAProxy {
  static NAME = BabaStr.BricksDataProxy;
  constructor() {
    super(BricksDataProxy.NAME);
  }

  public async setBricksType(node: TreeNodeModel, type) {
    bricksDataService.setBricksType(node, type);
  }

  // 创建一个新的分类
  public async newBrickGroup(name) {
    await bricksDataService.newBrickGroup(name);
  }
  // 删除一个分类
  public async removeBrickGroup(time) {
    await bricksDataService.removeBrickGroup(time);
  }

  public async getAllGroup() {
    return await bricksDataService.getAllGroup();
  }
}

export class BricksDataMediator extends BABAMediator {
  static NAME = BabaStr.BricksDataMediator;
  constructor() {
    super(BricksDataMediator.NAME);
  }

  listNotificationInterests(): string[] {
    return [
      BabaStr.VSCODE_DISPOST,
      BabaStr.BricksData_refresh,
      BabaStr.InitFile,
      BabaStr.QuestionData_ReBuildQuestionDataFinish,
      BabaStr.TreeData_searchTodayFinish,
      BabaStr.TreeData_searchUserContestFinish,
      BabaStr.TreeData_searchScoreRangeFinish,
      BabaStr.TreeData_searchContest,
      BabaStr.ConfigChange_hideScore,
      BabaStr.ConfigChange_SortStrategy,
      BabaStr.TreeData_favoriteChange,
      BabaStr.USER_statusChanged,
      BabaStr.statusBar_update_statusFinish,
      BabaStr.BABACMD_setBricksType,
      BabaStr.BABACMD_newBrickGroup,
      BabaStr.BABACMD_addQidToGroup,
      BabaStr.BABACMD_removeBrickGroup,
      BabaStr.BABACMD_removeQidFromGroup,
      BabaStr.BricksData_submitAndAccepted,
      BabaStr.BricksData_setBricksTypeFinish,
      BabaStr.BricksData_newBrickGroupFinish,
      BabaStr.BricksData_removeBrickGroupFinish,
      BabaStr.BricksData_addQidToGroupFinish,
      BabaStr.BricksData_removeQidFromGroupFinish,
      BabaStr.CommitResult_showFinish,
      BabaStr.BricksData_removeBricksHaveFinish,
      BabaStr.BABACMD_removeBricksHave,
      BabaStr.BABACMD_removeBricksNeedReviewDay,
      BabaStr.BABACMD_removeBricksNeedReviewDayNode
    ];
  }
  async handleNotification(_notification: BaseCC.BaseCC.INotification) {
    let body = _notification.getBody();
    switch (_notification.getName()) {
      case BabaStr.VSCODE_DISPOST:
        break;
      case BabaStr.InitFile:
        await bricksDataService.initialize();
        break;
      case BabaStr.BricksData_newBrickGroupFinish:
      case BabaStr.BricksData_removeBrickGroupFinish:
      case BabaStr.BricksData_addQidToGroupFinish:
      case BabaStr.BricksData_removeQidFromGroupFinish:
      case BabaStr.BricksData_setBricksTypeFinish:
      case BabaStr.BricksData_refresh:
      case BabaStr.BricksData_submitAndAccepted:
      case BabaStr.USER_statusChanged:
      case BabaStr.statusBar_update_statusFinish:
      case BabaStr.QuestionData_ReBuildQuestionDataFinish:
      case BabaStr.TreeData_searchTodayFinish:
      case BabaStr.TreeData_searchUserContestFinish:
      case BabaStr.TreeData_searchScoreRangeFinish:
      case BabaStr.TreeData_searchContest:
      case BabaStr.ConfigChange_hideScore:
      case BabaStr.ConfigChange_SortStrategy:
      case BabaStr.TreeData_favoriteChange:
      case BabaStr.BricksData_removeBricksHaveFinish:
        bricksDataService.fire();
        break;
      case BabaStr.CommitResult_showFinish:
        await bricksDataService.checkSubmit(_notification.getBody());
        break;
      case BabaStr.BABACMD_setBricksType:
        bricksViewController.setBricksType(body.node, body.type);
        break;
      case BabaStr.BABACMD_newBrickGroup:
        bricksViewController.newBrickGroup();
        break;
      case BabaStr.BABACMD_addQidToGroup:
        bricksViewController.addQidToGroup(body);
        break;
      case BabaStr.BABACMD_removeBrickGroup:
        bricksViewController.removeBrickGroup(body);
        break;
      case BabaStr.BABACMD_removeQidFromGroup:
        bricksViewController.removeQidFromGroup(body);
        break;
      case BabaStr.BABACMD_removeBricksHave:
        bricksViewController.removeBricksHave();
        break;
      case BabaStr.BABACMD_removeBricksNeedReviewDay:
        bricksViewController.removeBricksNeedReviewDay(body);
        break;
      case BabaStr.BABACMD_removeBricksNeedReviewDayNode:
        bricksViewController.removeBricksNeedReviewDayNode(body);
        break;
      default:
        break;
    }
  }
}
