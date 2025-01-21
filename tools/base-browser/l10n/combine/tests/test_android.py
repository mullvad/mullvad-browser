import textwrap

from combine import combine_files


def wrap_in_xml(content):
    if content is None:
        return None
    # Allow for indents to make the tests more readable.
    content = textwrap.dedent(content)
    return f"""\
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<resources>
{textwrap.indent(content, "    ")}</resources>
"""


def assert_result(new_content, old_content, expect):
    new_content = wrap_in_xml(new_content)
    old_content = wrap_in_xml(old_content)
    expect = wrap_in_xml(expect)
    assert expect == combine_files(
        "test_strings.xml", new_content, old_content, "REMOVED STRING"
    )


def test_combine_empty():
    assert_result(None, None, None)


def test_combine_new_file():
    # New file with no old content.
    assert_result(
        """\
        <string name="string_1">First</string>
        <string name="string_2">Second</string>
        """,
        None,
        """\
        <string name="string_1">First</string>
        <string name="string_2">Second</string>
        """,
    )


def test_combine_removed_file():
    # Entire file was removed.
    assert_result(
        None,
        """\
        <string name="string_1">First</string>
        <string name="string_2">Second</string>
        """,
        """\

        <!-- REMOVED STRING -->
        <string name="string_1">First</string>
        <!-- REMOVED STRING -->
        <string name="string_2">Second</string>
        """,
    )


def test_no_change():
    content = """\
        <string name="string_1">First</string>
        <string name="string_2">Second</string>
        """
    assert_result(content, content, content)


def test_added_string():
    assert_result(
        """\
        <string name="string_1">First</string>
        <string name="string_new">NEW</string>
        <string name="string_2">Second</string>
        """,
        """\
        <string name="string_1">First</string>
        <string name="string_2">Second</string>
        """,
        """\
        <string name="string_1">First</string>
        <string name="string_new">NEW</string>
        <string name="string_2">Second</string>
        """,
    )


def test_removed_string():
    assert_result(
        """\
        <string name="string_1">First</string>
        <string name="string_2">Second</string>
        """,
        """\
        <string name="string_1">First</string>
        <string name="removed">REMOVED</string>
        <string name="string_2">Second</string>
        """,
        """\
        <string name="string_1">First</string>
        <string name="string_2">Second</string>

        <!-- REMOVED STRING -->
        <string name="removed">REMOVED</string>
        """,
    )


def test_removed_and_added():
    assert_result(
        """\
        <string name="new_1">New string</string>
        <string name="string_1">First</string>
        <string name="string_2">Second</string>
        <string name="new_2">New string 2</string>
        """,
        """\
        <string name="string_1">First</string>
        <string name="removed_1">First removed</string>
        <string name="removed_2">Second removed</string>
        <string name="string_2">Second</string>
        <string name="removed_3">Third removed</string>
        """,
        """\
        <string name="new_1">New string</string>
        <string name="string_1">First</string>
        <string name="string_2">Second</string>
        <string name="new_2">New string 2</string>

        <!-- REMOVED STRING -->
        <string name="removed_1">First removed</string>
        <!-- REMOVED STRING -->
        <string name="removed_2">Second removed</string>
        <!-- REMOVED STRING -->
        <string name="removed_3">Third removed</string>
        """,
    )


def test_updated():
    # String content was updated.
    assert_result(
        """\
        <string name="changed_string">NEW</string>
        """,
        """\
        <string name="changed_string">OLD</string>
        """,
        """\
        <string name="changed_string">NEW</string>
        """,
    )


def test_updated_comment():
    # String comment was updated.
    assert_result(
        """\
        <!-- NEW -->
        <string name="changed_string">string</string>
        """,
        """\
        <!-- OLD -->
        <string name="changed_string">string</string>
        """,
        """\
        <!-- NEW -->
        <string name="changed_string">string</string>
        """,
    )
    # Comment added.
    assert_result(
        """\
        <!-- NEW -->
        <string name="changed_string">string</string>
        """,
        """\
        <string name="changed_string">string</string>
        """,
        """\
        <!-- NEW -->
        <string name="changed_string">string</string>
        """,
    )
    # Comment removed.
    assert_result(
        """\
        <string name="changed_string">string</string>
        """,
        """\
        <!-- OLD -->
        <string name="changed_string">string</string>
        """,
        """\
        <string name="changed_string">string</string>
        """,
    )

    # With file comments
    assert_result(
        """\
        <!-- NEW file comment -->

        <!-- NEW -->
        <string name="changed_string">string</string>
        """,
        """\
        <!-- OLD file comment -->

        <!-- OLD -->
        <string name="changed_string">string</string>
        """,
        """\
        <!-- NEW file comment -->

        <!-- NEW -->
        <string name="changed_string">string</string>
        """,
    )


def test_reordered():
    # String was re_ordered.
    assert_result(
        """\
        <string name="string_1">value</string>
        <string name="moved_string">move</string>
        """,
        """\
        <string name="moved_string">move</string>
        <string name="string_1">value</string>
        """,
        """\
        <string name="string_1">value</string>
        <string name="moved_string">move</string>
        """,
    )


def test_removed_string_with_comment():
    assert_result(
        """\
        <!-- Comment for first. -->
        <string name="string_1">First</string>
        <string name="string_2">Second</string>
        """,
        """\
        <!-- Comment for first. -->
        <string name="string_1">First</string>
        <!-- Comment for removed. -->
        <string name="removed">REMOVED</string>
        <string name="string_2">Second</string>
        """,
        """\
        <!-- Comment for first. -->
        <string name="string_1">First</string>
        <string name="string_2">Second</string>

        <!-- REMOVED STRING -->
        <!-- Comment for removed. -->
        <string name="removed">REMOVED</string>
        """,
    )

    # With file comments and multi-line.
    # All comments prior to a removed string are moved with it, until another
    # entity or blank line is reached.
    assert_result(
        """\
        <!-- First File comment -->

        <!-- Comment for first. -->
        <!-- Comment 2 for first. -->
        <string name="string_1">First</string>

        <!-- Second -->
        <!-- File comment -->

        <string name="string_2">Second</string>
        """,
        """\
        <!-- First File comment -->

        <!-- Comment for first. -->
        <!-- Comment 2 for first. -->
        <string name="string_1">First</string>
        <string name="removed_1">First removed</string>
        <!-- Comment for second removed. -->
        <string name="removed_2">Second removed</string>

        <!-- Removed file comment -->

        <!-- Comment 1 for third removed -->
        <!-- Comment 2 for third removed -->
        <string name="removed_3">Third removed</string>

        <!-- Second -->
        <!-- File comment -->

        <string name="removed_4">Fourth removed</string>
        <string name="string_2">Second</string>
        """,
        """\
        <!-- First File comment -->

        <!-- Comment for first. -->
        <!-- Comment 2 for first. -->
        <string name="string_1">First</string>

        <!-- Second -->
        <!-- File comment -->

        <string name="string_2">Second</string>

        <!-- REMOVED STRING -->
        <string name="removed_1">First removed</string>
        <!-- REMOVED STRING -->
        <!-- Comment for second removed. -->
        <string name="removed_2">Second removed</string>
        <!-- REMOVED STRING -->
        <!-- Comment 1 for third removed -->
        <!-- Comment 2 for third removed -->
        <string name="removed_3">Third removed</string>
        <!-- REMOVED STRING -->
        <string name="removed_4">Fourth removed</string>
        """,
    )
