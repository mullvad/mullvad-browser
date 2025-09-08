import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import mozunit

from mozbuild.tbbutils import get_artifact_path, list_files_http


class TestGetArtifactName(unittest.TestCase):
    def setUp(self):
        self.artifact = "artifact"
        self.host = "linux64"

    @patch("mozbuild.tbbutils.TOR_BROWSER_BUILD_ARTIFACTS", new=["artifact"])
    def test_artifact_in_tbb_artifacts(self):
        from mozbuild.tbbutils import get_artifact_name

        result = get_artifact_name(self.artifact, self.host)
        self.assertEqual(result, self.artifact)

    @patch("mozbuild.tbbutils.ARTIFACT_NAME_MAP", new={"artifact": "tcafitra"})
    def test_host_is_not_linux64(self):
        from mozbuild.tbbutils import get_artifact_name

        result = get_artifact_name(self.artifact, "linux64-aarch64")
        self.assertIsNone(result)

    @patch("mozbuild.tbbutils.ARTIFACT_NAME_MAP", new={"artifact": "tcafitra"})
    def test_mapped_artifact(self):
        from mozbuild.tbbutils import get_artifact_name

        result = get_artifact_name(self.artifact, self.host)
        self.assertEqual(result, self.artifact[::-1])


class TestGetArtifactPath(unittest.TestCase):
    def setUp(self):
        self.url = "http://example.com"
        self.artifact = "artifact"
        # This is just an example target which is valid. But it doesn't make
        # any difference and could be anything for these tests.
        self.target = SimpleNamespace(tor_browser_build_alias="linux", cpu="x86_64")

    @patch("mozbuild.tbbutils.list_files_http")
    def test_no_files_returns_none(self, mock_list_files):
        mock_list_files.return_value = []
        result = get_artifact_path(self.url, self.artifact, self.target)
        self.assertIsNone(result)

    @patch("mozbuild.tbbutils.list_files_http")
    def test_no_matching_files_returns_none(self, mock_list_files):
        mock_list_files.return_value = ["somethingelse.zip", "yetanotherthing.zip"]
        result = get_artifact_path(self.url, self.artifact, self.target)
        self.assertIsNone(result)

    @patch("mozbuild.tbbutils.list_files_http")
    def test_single_artifact_match(self, mock_list_files):
        mock_list_files.return_value = ["artifact-1.zip"]
        result = get_artifact_path(self.url, self.artifact, self.target)
        self.assertEqual(result, f"{self.url}/{self.artifact}/artifact-1.zip")

    @patch("mozbuild.tbbutils.list_files_http")
    def test_artifact_without_os_returns_first(self, mock_list_files):
        mock_list_files.return_value = ["artifact-1.zip", "artifact-2.zip"]
        result = get_artifact_path(self.url, self.artifact, self.target)
        self.assertTrue(result.startswith(f"{self.url}/{self.artifact}/"))
        self.assertIn("artifact-", result)

    @patch("mozbuild.tbbutils.list_files_http")
    def test_artifact_with_os_match(self, mock_list_files):
        mock_list_files.return_value = [
            "artifact-windows.zip",
            "artifact-linux.zip",
        ]
        result = get_artifact_path(self.url, self.artifact, self.target)
        self.assertEqual(result, f"{self.url}/{self.artifact}/artifact-linux.zip")

    @patch("mozbuild.tbbutils.list_files_http")
    def test_artifact_with_cpu_match(self, mock_list_files):
        mock_list_files.return_value = [
            "artifact-linux-arm.zip",
            "artifact-linux-x86_64.zip",
        ]
        result = get_artifact_path(self.url, self.artifact, self.target)
        self.assertEqual(
            result, f"{self.url}/{self.artifact}/artifact-linux-x86_64.zip"
        )

    @patch("mozbuild.tbbutils.list_files_http")
    def test_artifact_with_prefix(self, mock_list_files):
        mock_list_files.return_value = ["artifact-1.zip"]

        prefix = "prefix"
        result = get_artifact_path(self.url, self.artifact, self.target, prefix=prefix)
        self.assertEqual(result, f"{self.url}/{prefix}/artifact-1.zip")
        mock_list_files.assert_called_with(f"{self.url}/{prefix}?C=M;O=D")


class TestListFilesHttp(unittest.TestCase):
    def setUp(self):
        self.url = "http://example.com"

    @patch("mozbuild.tbbutils.urlopen")
    def test_non_200_status_returns_empty(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 404
        mock_resp.read.return_value = b""
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        result = list_files_http(self.url)
        self.assertEqual(result, [])

    @patch("mozbuild.tbbutils.urlopen")
    def test_exception_returns_empty(self, mock_urlopen):
        mock_urlopen.side_effect = Exception("network error")
        result = list_files_http(self.url)
        self.assertEqual(result, [])

    @patch("mozbuild.tbbutils.urlopen")
    def test_regular_links(self, mock_urlopen):
        html = b"""
        <html><body>
        <a href="../">Parent</a>
        <a href="file1.zip">file1</a>
        <a href="file2.zip">file2</a>
        </body></html>
        """
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = html
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        result = list_files_http(self.url)
        self.assertEqual(result, ["file1.zip", "file2.zip"])


if __name__ == "__main__":
    mozunit.main()
