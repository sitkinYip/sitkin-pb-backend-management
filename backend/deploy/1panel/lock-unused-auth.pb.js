$app.rootCmd.addCommand(new Command({
  use: "questions-lock-unused-auth",
  run: () => {
    if (!$app.isBootstrapped()) $app.bootstrap();
    const collection = $app.findCollectionByNameOrId("users");
    if ($app.countRecords("users") !== 0) throw new Error("Default users collection is not empty; refusing change");
    collection.createRule = null;
    $app.save(collection);
    console.log("Unused default auth collection registration locked.");
  }
}));
