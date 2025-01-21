import textwrap

from combine import combine_files


def assert_result(new_content, old_content, expect):
    # Allow for indents to make the tests more readable.
    if new_content is not None:
        new_content = textwrap.dedent(new_content)
    if old_content is not None:
        old_content = textwrap.dedent(old_content)
    if expect is not None:
        expect = textwrap.dedent(expect)
    assert expect == combine_files(
        "test.dtd", new_content, old_content, "REMOVED STRING"
    )


def test_combine_empty():
    assert_result(None, None, None)


def test_combine_new_file():
    # New file with no old content.
    assert_result(
        """\
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">
        """,
        None,
        """\
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">
        """,
    )


def test_combine_removed_file():
    # Entire file was removed.
    assert_result(
        None,
        """\
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">
        """,
        """\

        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!ENTITY string.1 "First">
        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!ENTITY string.2 "Second">
        """,
    )


def test_no_change():
    content = """\
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">
        """
    assert_result(content, content, content)


def test_added_string():
    assert_result(
        """\
        <!ENTITY string.1 "First">
        <!ENTITY string.new "NEW">
        <!ENTITY string.2 "Second">
        """,
        """\
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">
        """,
        """\
        <!ENTITY string.1 "First">
        <!ENTITY string.new "NEW">
        <!ENTITY string.2 "Second">
        """,
    )


def test_removed_string():
    assert_result(
        """\
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">
        """,
        """\
        <!ENTITY string.1 "First">
        <!ENTITY removed "REMOVED">
        <!ENTITY string.2 "Second">
        """,
        """\
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">

        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!ENTITY removed "REMOVED">
        """,
    )


def test_removed_and_added():
    assert_result(
        """\
        <!ENTITY new.1 "New string">
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">
        <!ENTITY new.2 "New string 2">
        """,
        """\
        <!ENTITY string.1 "First">
        <!ENTITY removed.1 "First removed">
        <!ENTITY removed.2 "Second removed">
        <!ENTITY string.2 "Second">
        <!ENTITY removed.3 "Third removed">
        """,
        """\
        <!ENTITY new.1 "New string">
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">
        <!ENTITY new.2 "New string 2">

        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!ENTITY removed.1 "First removed">
        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!ENTITY removed.2 "Second removed">
        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!ENTITY removed.3 "Third removed">
        """,
    )


def test_updated():
    # String content was updated.
    assert_result(
        """\
        <!ENTITY changed.string "NEW">
        """,
        """\
        <!ENTITY changed.string "OLD">
        """,
        """\
        <!ENTITY changed.string "NEW">
        """,
    )


def test_updated_comment():
    # String comment was updated.
    assert_result(
        """\
        <!-- LOCALIZATION NOTE: NEW -->
        <!ENTITY changed.string "string">
        """,
        """\
        <!-- LOCALIZATION NOTE: OLD -->
        <!ENTITY changed.string "string">
        """,
        """\
        <!-- LOCALIZATION NOTE: NEW -->
        <!ENTITY changed.string "string">
        """,
    )
    # Comment added.
    assert_result(
        """\
        <!-- LOCALIZATION NOTE: NEW -->
        <!ENTITY changed.string "string">
        """,
        """\
        <!ENTITY changed.string "string">
        """,
        """\
        <!-- LOCALIZATION NOTE: NEW -->
        <!ENTITY changed.string "string">
        """,
    )
    # Comment removed.
    assert_result(
        """\
        <!ENTITY changed.string "string">
        """,
        """\
        <!-- LOCALIZATION NOTE: OLD -->
        <!ENTITY changed.string "string">
        """,
        """\
        <!ENTITY changed.string "string">
        """,
    )

    # With multiple comments
    assert_result(
        """\
        <!-- NEW FILE COMMENT -->

        <!-- LOCALIZATION NOTE: NEW -->
        <!ENTITY changed.string "string">
        """,
        """\
        <!-- OLD -->

        <!-- LOCALIZATION NOTE: OLD -->
        <!ENTITY changed.string "string">
        """,
        """\
        <!-- NEW FILE COMMENT -->

        <!-- LOCALIZATION NOTE: NEW -->
        <!ENTITY changed.string "string">
        """,
    )


def test_reordered():
    # String was re.ordered.
    assert_result(
        """\
        <!ENTITY string.1 "value">
        <!ENTITY moved.string "move">
        """,
        """\
        <!ENTITY moved.string "move">
        <!ENTITY string.1 "value">
        """,
        """\
        <!ENTITY string.1 "value">
        <!ENTITY moved.string "move">
        """,
    )


def test_removed_string_with_comment():
    assert_result(
        """\
        <!-- LOCALIZATION NOTE: Comment for first. -->
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">
        """,
        """\
        <!-- LOCALIZATION NOTE: Comment for first. -->
        <!ENTITY string.1 "First">
        <!-- LOCALIZATION NOTE: Comment for removed. -->
        <!ENTITY removed "REMOVED">
        <!ENTITY string.2 "Second">
        """,
        """\
        <!-- LOCALIZATION NOTE: Comment for first. -->
        <!ENTITY string.1 "First">
        <!ENTITY string.2 "Second">

        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!-- LOCALIZATION NOTE: Comment for removed. -->
        <!ENTITY removed "REMOVED">
        """,
    )

    # With multiple lines of comments.

    assert_result(
        """\
        <!-- First file comment -->

        <!-- LOCALIZATION NOTE: Comment for first. -->
        <!-- LOCALIZATION NOTE: Comment 2 for first. -->
        <!ENTITY string.1 "First">

        <!-- Second
           - file
           - comment -->

        <!ENTITY string.2 "Second">
        """,
        """\
        <!-- First file comment -->

        <!-- LOCALIZATION NOTE: Comment for first. -->
        <!ENTITY string.1 "First">
        <!ENTITY removed.1 "First removed">
        <!-- LOCALIZATION NOTE: Comment for second removed. -->
        <!ENTITY removed.2 "Second removed">

        <!-- Removed file comment -->

        <!-- LOCALIZATION NOTE: Comment for third removed. -->
        <!-- LOCALIZATION NOTE: Comment 2 for
        third removed. -->
        <!ENTITY removed.3 "Third removed">

        <!-- Second
           - file
           - comment -->

        <!ENTITY removed.4 "Fourth removed">
        <!ENTITY string.2 "Second">
        """,
        """\
        <!-- First file comment -->

        <!-- LOCALIZATION NOTE: Comment for first. -->
        <!-- LOCALIZATION NOTE: Comment 2 for first. -->
        <!ENTITY string.1 "First">

        <!-- Second
           - file
           - comment -->

        <!ENTITY string.2 "Second">

        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!ENTITY removed.1 "First removed">
        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!-- LOCALIZATION NOTE: Comment for second removed. -->
        <!ENTITY removed.2 "Second removed">
        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!-- LOCALIZATION NOTE: Comment for third removed. -->
        <!-- LOCALIZATION NOTE: Comment 2 for
        third removed. -->
        <!ENTITY removed.3 "Third removed">
        <!-- LOCALIZATION NOTE: REMOVED STRING -->
        <!ENTITY removed.4 "Fourth removed">
        """,
    )
