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
        "test.ftl", new_content, old_content, "REMOVED STRING"
    )


def test_combine_empty():
    assert_result(None, None, None)


def test_combine_new_file():
    # New file with no old content.
    assert_result(
        """\
        string-1 = First
        string-2 = Second
        """,
        None,
        """\
        string-1 = First
        string-2 = Second
        """,
    )


def test_combine_removed_file():
    # Entire file was removed.
    assert_result(
        None,
        """\
        string-1 = First
        string-2 = Second
        """,
        """\


        ## REMOVED STRING

        string-1 = First
        string-2 = Second
        """,
    )


def test_no_change():
    content = """\
        string-1 = First
        string-2 = Second
        """
    assert_result(content, content, content)


def test_added_string():
    assert_result(
        """\
        string-1 = First
        string-new = NEW
        string-2 = Second
        """,
        """\
        string-1 = First
        string-2 = Second
        """,
        """\
        string-1 = First
        string-new = NEW
        string-2 = Second
        """,
    )


def test_removed_string():
    assert_result(
        """\
        string-1 = First
        string-2 = Second
        """,
        """\
        string-1 = First
        removed = REMOVED
        string-2 = Second
        """,
        """\
        string-1 = First
        string-2 = Second


        ## REMOVED STRING

        removed = REMOVED
        """,
    )


def test_removed_and_added():
    assert_result(
        """\
        new-1 = New string
        string-1 =
            .attr = First
        string-2 = Second
        new-2 =
            .title = New string 2
        """,
        """\
        string-1 =
            .attr = First
        removed-1 = First removed
        removed-2 =
            .attr = Second removed
        string-2 = Second
        removed-3 = Third removed
        """,
        """\
        new-1 = New string
        string-1 =
            .attr = First
        string-2 = Second
        new-2 =
            .title = New string 2


        ## REMOVED STRING

        removed-1 = First removed
        removed-2 =
            .attr = Second removed
        removed-3 = Third removed
        """,
    )


def test_updated():
    # String content was updated.
    assert_result(
        """\
        changed-string = NEW
        """,
        """\
        changed-string = OLD
        """,
        """\
        changed-string = NEW
        """,
    )


def test_updated_comment():
    # String comment was updated.
    assert_result(
        """\
        # NEW
        changed-string = string
        """,
        """\
        # OLD
        changed-string = string
        """,
        """\
        # NEW
        changed-string = string
        """,
    )
    # Comment added.
    assert_result(
        """\
        # NEW
        changed-string = string
        """,
        """\
        changed-string = string
        """,
        """\
        # NEW
        changed-string = string
        """,
    )
    # Comment removed.
    assert_result(
        """\
        changed-string = string
        """,
        """\
        # OLD
        changed-string = string
        """,
        """\
        changed-string = string
        """,
    )

    # With group comments.
    assert_result(
        """\
        ## GROUP NEW

        # NEW
        changed-string = string
        """,
        """\
        ## GROUP OLD

        # OLD
        changed-string = string
        """,
        """\
        ## GROUP NEW

        # NEW
        changed-string = string
        """,
    )


def test_reordered():
    # String was re-ordered.
    assert_result(
        """\
        string-1 = value
        moved-string = move
        """,
        """\
        moved-string = move
        string-1 = value
        """,
        """\
        string-1 = value
        moved-string = move
        """,
    )


def test_removed_string_with_comment():
    assert_result(
        """\
        # Comment for first.
        string-1 = First
        string-2 = Second
        """,
        """\
        # Comment for first.
        string-1 = First
        # Comment for removed.
        removed = REMOVED
        string-2 = Second
        """,
        """\
        # Comment for first.
        string-1 = First
        string-2 = Second


        ## REMOVED STRING

        # Comment for removed.
        removed = REMOVED
        """,
    )

    # Group comments are combined with the "REMOVED STRING" comments.
    # If strings have no group comment, then a single "REMOVED STRING" is
    # included for them.
    assert_result(
        """\
        ## First Group comment

        # Comment for first.
        string-1 = First

        ##

        no-group = No group comment

        ## Second
        ## Group comment

        string-2 = Second
        """,
        """\
        ## First Group comment

        # Comment for first.
        string-1 = First
        removed-1 = First removed
        # Comment for second removed.
        removed-2 = Second removed

        ##

        no-group = No group comment
        removed-3 = Third removed

        ## Second
        ## Group comment

        removed-4 = Fourth removed
        string-2 = Second
        """,
        """\
        ## First Group comment

        # Comment for first.
        string-1 = First

        ##

        no-group = No group comment

        ## Second
        ## Group comment

        string-2 = Second


        ## REMOVED STRING
        ## First Group comment

        removed-1 = First removed
        # Comment for second removed.
        removed-2 = Second removed

        ## REMOVED STRING

        removed-3 = Third removed

        ## REMOVED STRING
        ## Second
        ## Group comment

        removed-4 = Fourth removed
        """,
    )
