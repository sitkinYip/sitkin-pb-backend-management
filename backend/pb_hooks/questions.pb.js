for (const method of ["GET", "POST", "PATCH"]) {
  routerAdd(
    method,
    "/api/questions/v1/{path...}",
    (e) => {
      try {
        return e.json(200, require(`${__hooks}/lib/api.js`).handle(e));
      } catch (error) {
        if (error.businessCode)
          return e.json(error.status || 400, {
            error: { code: error.businessCode, message: error.message },
          });
        e.app
          .logger()
          .error(
            "Questions request failed",
            "errorType",
            error.name || "Error",
          );
        return e.json(500, {
          error: { code: "INTERNAL_ERROR", message: "操作失败，请稍后重试" },
        });
      }
    },
    $apis.requireAuth("game_players", "game_admins"),
    $apis.bodyLimit(2500000),
  );
}
