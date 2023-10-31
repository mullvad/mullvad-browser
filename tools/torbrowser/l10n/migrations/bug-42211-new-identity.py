import fluent.syntax.ast as FTL
from fluent.migrate.helpers import TERM_REFERENCE, transforms_from
from fluent.migrate.transforms import REPLACE


def migrate(ctx):
    legacy_path = "newIdentity.properties"

    ctx.add_transforms(
        "base-browser.ftl",
        "base-browser.ftl",
        transforms_from(
            """
menu-new-identity =
    .label = { COPY(path, "new_identity") }
    .accesskey = { COPY(path, "new_identity_menu_accesskey") }
appmenuitem-new-identity =
    .label = { COPY(path, "new_identity_sentence_case") }
toolbar-new-identity =
    .label = { COPY(path, "new_identity_sentence_case") }
    .tooltiptext = { toolbar-new-identity.label }

new-identity-dialog-title = { COPY(path, "new_identity_prompt_title") }
new-identity-dialog-never-ask-checkbox =
    .label = { COPY(path, "new_identity_ask_again") }

new-identity-blocked-home-ignore-button = { COPY(path, "new_identity_home_load_button") }
""",
            path=legacy_path,
        )
        + [
            # Replace "%S" with "{ -brand-short-name }" in confirm button.
            FTL.Message(
                id=FTL.Identifier("new-identity-dialog-confirm"),
                value=None,
                attributes=[
                    FTL.Attribute(
                        id=FTL.Identifier("label"),
                        value=REPLACE(
                            legacy_path,
                            "new_identity_restart",
                            {"%1$S": TERM_REFERENCE("brand-short-name")},
                        ),
                    ),
                ],
            ),
        ],
    )
