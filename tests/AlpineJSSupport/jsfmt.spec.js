require("../../tests_config/run_spec");

run_spec(__dirname, ["melody"], {
    twigMelodyAlpineSupport: true,
    twigMelodyPreserveCSSFormat: true,
    twigMelodyAlpineDirectiveSpacing: "consistent",
});
