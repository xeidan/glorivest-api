const router = require("express").Router();

const auth = require("../middleware/auth");

const admin = require("../../middleware/admin");

const controller = require("../controllers/admin.settings.controller");

router.get(

    "/",

    auth,

    admin,

    controller.getSettings

);

router.put(

    "/",

    auth,

    admin,

    controller.updateSettings

);

module.exports = router;