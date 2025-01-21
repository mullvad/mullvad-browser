import re
from typing import TYPE_CHECKING, Any

from compare_locales.parser import getParser
from compare_locales.parser.android import AndroidEntity, DocumentWrapper
from compare_locales.parser.base import Comment, Entity, Junk, Whitespace
from compare_locales.parser.dtd import DTDEntity
from compare_locales.parser.fluent import FluentComment, FluentEntity
from compare_locales.parser.properties import PropertiesEntity

if TYPE_CHECKING:
    from collections.abc import Iterable


def combine_files(
    filename: str,
    primary_content: str | None,
    alternative_content: str | None,
    comment_prefix: str,
    include_ids: list[str] | None = None,
    alternative_suffix: str = "",
) -> str | None:
    """Combine two translation files into one to include all strings from both.
    The primary content is presented first, followed by the alternative content
    at the end with an additional comment.

    :param filename: The filename for the file, determines the format.
    :param primary_content: The primary content for the file, or None if it does
      not exist.
    :param alternative_content: The alternative content for the file, or None if
      it does not exist.
    :param comment_prefix: A comment to include for any strings that are
      appended to the content. This will be placed before any other comments for
      the string.
    :param include_ids: String IDs from `alternative_content` we want to
      include. If this is `None` then we include all strings that do not already
      have a matching ID in `primary_content`.
    :param duplicate_suffix: The suffix to apply to the alternative IDs.

    :returns: The combined content, or None if both given contents are None.
    """
    if primary_content is None and alternative_content is None:
        return None

    # getParser from compare_locale returns the same instance for the same file
    # extension.
    parser = getParser(filename)

    is_android = filename.endswith(".xml")
    if primary_content is None:
        if is_android:
            # File was deleted, add some document parts.
            content_start = (
                '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<resources>\n'
            )
            content_end = "</resources>\n"
        else:
            # Treat as an empty file.
            content_start = ""
            content_end = ""
        existing_keys = []
    else:
        parser.readUnicode(primary_content)

        # Start with the same content as the current file.
        # For android strings, we want to keep the final "</resources>" until after.
        if is_android:
            closing_match = re.match(
                r"^(.*)(</resources>\s*)$", parser.ctx.contents, re.DOTALL
            )
            if not closing_match:
                raise ValueError("Missing a final </resources>")
            content_start = closing_match.group(1)
            content_end = closing_match.group(2)
        else:
            content_start = parser.ctx.contents
            content_end = ""
        existing_keys = [entry.key for entry in parser.walk(only_localizable=True)]

    # For Fluent, we want to prefix the strings using GroupComments.
    # On weblate this will cause all the strings that fall under the GroupComment's
    # scope to have the prefix added to their "notes".
    # We set up an initial GroupComment for the first string we find. This will also
    # end the scope of the last GroupComment in the new translation file.
    # This will be replaced with a the next GroupComment when it is found.
    fluent_group_comment_prefix = f"\n## {comment_prefix}\n"
    fluent_group_comment: str | None = fluent_group_comment_prefix

    # For other formats, we want to keep all the comment lines that come directly
    # before the string.
    # In compare_locales.parser, only the comment line directly before an Entity
    # counts as the pre_comment for that Entity. I.e. only this line will be
    # included in Entity.all
    # However, in weblate every comment line that comes before the Entity is
    # included as a comment. So we also want to keep these additional comments to
    # preserve them for weblate.
    # We gather these extra comments in stacked_comments, and clear them whenever we
    # reach an Entity or a blank line (Whitespace is more than "\n").
    stacked_comments: list[str] = []

    additions: list[str] = []

    entry_iter: Iterable[Any] = ()
    # If the file does not exist in the old branch, don't make any additions.
    if alternative_content is not None:
        parser.readUnicode(alternative_content)
        entry_iter = parser.walk(only_localizable=False)
    for entry in entry_iter:
        if isinstance(entry, Junk):
            raise ValueError(f"Unexpected Junk: {entry.all}")
        if isinstance(entry, Whitespace):
            # Clear stacked comments if more than one empty line.
            if entry.all != "\n":
                stacked_comments.clear()
            continue
        if isinstance(entry, Comment):
            if isinstance(entry, FluentComment):
                # Don't stack Fluent comments.
                # Only the comments included in Entity.pre_comment count towards
                # that Entity's comment.
                if entry.all.startswith("##"):
                    # A Fluent GroupComment
                    if entry.all == "##":
                        # Empty GroupComment. Used to end the scope of a previous
                        # GroupComment.
                        # Replace this with our prefix comment.
                        fluent_group_comment = fluent_group_comment_prefix
                    else:
                        # Prefix the group comment.
                        fluent_group_comment = (
                            f"{fluent_group_comment_prefix}{entry.all}\n"
                        )
            else:
                stacked_comments.append(entry.all)
            continue
        if isinstance(entry, DocumentWrapper):
            # Not needed.
            continue

        if not isinstance(entry, Entity):
            raise ValueError(f"Unexpected type: {entry.__class__.__name__}")

        if include_ids is None:
            # We include the entry if it is not already included.
            include_entry = entry.key not in existing_keys
        else:
            # We include the entry if it is in our list.
            include_entry = entry.key in include_ids
        if not include_entry:
            # Drop the gathered comments for this Entity.
            stacked_comments.clear()
            continue

        if isinstance(entry, FluentEntity):
            id_regex = rf"^({re.escape(entry.key)})( *=)"
            if fluent_group_comment is not None:
                # We have a found GroupComment which has not been included yet.
                # All following Entity's will be under its scope, until the next
                # GroupComment.
                additions.append(fluent_group_comment)
                # Added GroupComment, so don't need to add again.
                fluent_group_comment = None
        elif isinstance(entry, DTDEntity):
            id_regex = rf"^(\s*<!ENTITY\s*{re.escape(entry.key)})(\s)"
            # Include our additional comment before we print the rest for this
            # Entity.
            additions.append(f"<!-- LOCALIZATION NOTE: {comment_prefix} -->")
        elif isinstance(entry, PropertiesEntity):
            id_regex = rf"^({re.escape(entry.key)})( *=)"
            additions.append(f"# {comment_prefix}")
        elif isinstance(entry, AndroidEntity):
            id_regex = rf'^(\s*<string\s[^>]*name="{re.escape(entry.key)})(")'
            additions.append(f"<!-- {comment_prefix} -->")
        else:
            raise ValueError(f"Unexpected Entity type: {entry.__class__.__name__}")

        # Add any other comment lines that came directly before this Entity.
        additions.extend(stacked_comments)
        stacked_comments.clear()
        entry_content = entry.all
        if alternative_suffix:
            # NOTE: compare_locales does not allow us to set the entry.key
            # value. Instead we use a regular expression to append the suffix to
            # the expected key.
            entry_content, count = re.subn(
                id_regex, rf"\1{alternative_suffix}\2", entry_content, flags=re.M
            )
            if count != 1:
                raise ValueError(f"Failed to substitute the ID for {entry.key}")
        additions.append(entry_content)

    content_middle = ""

    if additions:
        # New line before and after the additions
        additions.insert(0, "")
        additions.append("")
        if is_android:
            content_middle = "\n    ".join(additions)
        else:
            content_middle = "\n".join(additions)

        # Remove " " in otherwise blank lines.
        content_middle = re.sub("^ +$", "", content_middle, flags=re.MULTILINE)

    return content_start + content_middle + content_end
