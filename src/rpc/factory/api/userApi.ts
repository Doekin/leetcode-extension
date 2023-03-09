/*
 * https://github.com/ccagml/leetcode-extension/src/rpc/factory/api/userApi.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, November 17th 2022, 11:44:14 am
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */

let prompt_out = require("prompt");

import { reply } from "../../utils/ReplyUtils";

import { sessionUtils } from "../../utils/sessionUtils";
import { ApiBase } from "../apiBase";

import { chainMgr } from "../../actionChain/chainManager";
import { configUtils } from "../../utils/configUtils";

class UserApi extends ApiBase {
  constructor() {
    super();
  }

  callArg(argv) {
    let argv_config = this.api_argv()
      .option("l", {
        alias: "login",
        type: "boolean",
        default: false,
        describe: "Login",
      })
      .option("c", {
        alias: "cookie",
        type: "boolean",
        default: false,
        describe: "cookieLogin",
      })
      .option("g", {
        alias: "github",
        type: "boolean",
        default: false,
        describe: "githubLogin",
      })
      .option("i", {
        alias: "linkedin",
        type: "boolean",
        default: false,
        describe: "linkedinLogin",
      })
      .option("L", {
        alias: "logout",
        type: "boolean",
        default: false,
        describe: "Logout",
      });
    argv_config.parseArgFromCmd(argv);

    return argv_config.get_result();
  }

  call(argv) {
    sessionUtils.argv = argv;
    let user: any = null;
    if (argv.login) {
      let login_info: any = {};
      login_info.name = configUtils.LCPRENVEXTRA?.name || "";
      login_info.pass = configUtils.LCPRENVEXTRA?.pass || "";
      chainMgr.getChainHead().normalLogin(login_info, function (e, user) {
        if (e) {
          return reply.info(JSON.stringify({ code: -2, msg: e.msg || e }));
        }
        reply.info(JSON.stringify({ code: 100, user_name: user.name }));
      });
      // // login
      // prompt_out.colors = false;
      // prompt_out.message = "";
      // prompt_out.start();
      // prompt_out.get(
      //   [
      //     { name: "login", required: true },
      //     { name: "pass", required: true, hidden: true },
      //   ],
      //   function (e, user) {
      //     if (e) {
      //       return reply.info(JSON.stringify({ code: -1, msg: e.msg || e }));
      //     }
      //     chainMgr.getChainHead().login(user, function (e, user) {
      //       if (e) {
      //         return reply.info(JSON.stringify({ code: -2, msg: e.msg || e }));
      //       }
      //       reply.info(JSON.stringify({ code: 100, user_name: user.name }));
      //     });
      //   }
      // );
    } else if (argv.logout) {
      // logout
      user = chainMgr.getChainHead().logout(user, true);
      if (user) reply.info(JSON.stringify({ code: 100, user_name: user.name }));
      else reply.info(JSON.stringify({ code: -3, msg: "You are not login yet?" }));
      // third parties
    } else if (argv.github || argv.linkedin) {
      // add future third parties here
      const functionMap = new Map([
        ["g", chainMgr.getChainHead().githubLogin],
        ["github", chainMgr.getChainHead().githubLogin],
        ["i", chainMgr.getChainHead().linkedinLogin],
        ["linkedin", chainMgr.getChainHead().linkedinLogin],
      ]);
      const keyword = Object.entries(argv).filter((i) => i[1] === true)[0][0];
      const coreFunction = functionMap.get(keyword);
      if (coreFunction) {
        prompt_out.colors = false;
        prompt_out.message = "";
        prompt_out.start();
        prompt_out.get(
          [
            { name: "login", required: true },
            { name: "pass", required: true, hidden: true },
          ],
          function (e, user) {
            if (e) return reply.info(JSON.stringify({ code: -4, msg: e.msg || e }));
            coreFunction(user, function (e, user) {
              if (e) return reply.info(JSON.stringify({ code: -5, msg: e.msg || e }));
              reply.info(JSON.stringify({ code: 100, user_name: user.name }));
            });
          }
        );
      }
    } else if (argv.cookie) {
      // session
      prompt_out.colors = false;
      prompt_out.message = "";
      prompt_out.start();
      prompt_out.get(
        [
          { name: "login", required: true },
          { name: "cookie", required: true },
        ],
        function (e, user) {
          if (e) return reply.info(e);
          chainMgr.getChainHead().cookieLogin(user, function (e, user) {
            if (e) return reply.info(JSON.stringify({ code: -6, msg: e.msg || e }));
            reply.info(JSON.stringify({ code: 100, user_name: user.name }));
          });
        }
      );
    } else {
      // show current user
      user = sessionUtils.getUser();
      if (user) {
        reply.info(JSON.stringify({ code: 100, user_name: user.name }));
      } else return reply.info(JSON.stringify({ code: -7, msg: "You are not login yet?" }));
    }
  }
}

export const userApi: UserApi = new UserApi();
