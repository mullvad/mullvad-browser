#!/usr/bin/env bash

# prints to stderr
function echoerr() { echo "$@" 1>&2; }

# help dialog
if [ "$#" -lt 5 ]; then
    echoerr "Usage: $0 ff-version begin-commit end-commit gitlab-audit-issue reviewers..."
    echoerr ""
    echoerr "Writes a CSV to stdout of Bugzilla issues to triage for a particular Firefox version. This"
    echoerr "script performs a union of the labeled Bugzilla issues in Mozilla's issue tracker and the"
    echoerr "labeled commits in the provided commit range"
    echoerr
    echoerr "    ff-version             rapid-release Firefox version to audit"
    echoerr "    begin-commit           starting gecko-dev commit of this Firefox version"
    echoerr "    end-commit             ending gecko-dev commit of this Firefox version"
    echoerr "    gitlab-audit-issue     tor-browser-spec Gitlab issue number for this audit"
    echoerr "    reviewers...           space-separated list of reviewers responsible for this audit"
    echoerr ""
    echoerr "Example:"
    echoerr ""
    echoerr "$0 116 FIREFOX_ESR_115_BASE FIREFOX_116_0_3_RELEASE 40064 richard pierov henry"
    exit 1
fi

# set -x
set -e


# Ensure various required tools are available
function check_exists() {
    local cmd=$1
    if ! which ${cmd} > /dev/null ; then
        echoerr "missing ${cmd} dependency"
        exit 1
    fi
}

check_exists git
check_exists jq
check_exists mktemp
check_exists perl
check_exists printf
check_exists sed
check_exists sort
check_exists touch
check_exists uniq
check_exists wget

# Assign arguments to named variables
firefox_version=$1
git_begin=$2
git_end=$3
audit_issue=$4
reviewers="${@:5}"

# Check valid Firefox version
if ! [[ "${firefox_version}" =~ ^[1-9][0-9]{2}$ ]]; then
    echoerr "invalid Firefox version (probably)"
    exit 1
fi

# Check valid Gitlab issue number
if ! [[ "${audit_issue}" =~ ^[1-9][0-9]{4}$ ]]; then
    echoerr "invalid gitlab audit issue number (probably)"
    exit 1
fi

#
# Encoding/Decoding Functions
#

# escape " and \
function json_escape() {
    local input="$1"
    echo "${input}" | sed 's/["\]/\\"/g'
}


# un-escape \"
function jq_unescape() {
    local input="$1"
    echo "${input}" | sed 's/\\"/"/g'
}

# change quotes to double-quotes
function csv_escape() {
    local input="$1"
    echo "${input}" | sed 's/"/""/g'
}

# we need to urlencode the strings used in the new issue link
function url_encode() {
    local input="$1"
    echo "${input}" | perl -MURI::Escape -wlne 'print uri_escape $_'
}


#
# Create temp json files
#
git_json=$(mktemp -t git-audit-${firefox_version}-XXXXXXXXXXX.json)
bugzilla_json=$(mktemp -t bugzilla-audit-${firefox_version}-XXXXXXXXXXX.json)
union_json=$(mktemp -t union-audit-${firefox_version}-XXXXXXXXXXX.json)
touch "${git_json}"
touch "${bugzilla_json}"
touch "${union_json}"

function json_cleanup {
    rm -f "${git_json}"
    rm -f "${bugzilla_json}"
    rm -f "${union_json}"
}
trap json_cleanup EXIT

#
# Generate Git Commit Triage List
#

# Try and extract bug id and summary from git log
# Mozilla's commits are not always 100% consistently named, so this
# regex is a bit flexible to handle various inputs such as:
# "Bug 1234 -", "Bug 1234:", "Bug Bug 1234 -", "[Bug 1234] -", " bug 1234 -".
sed_extract_id_summary="s/^[[ ]*[bug –-]+ ([1-9][0-9]*)[]:\., –-]*(.*)\$/\\1 \\2/pI"

# Generate a json array of objects in the same format as bugzilla: {id: number, summary: string}
printf "[\n" >> "${git_json}"

first_object=true
git log --format='%s' $git_begin..$git_end  \
| sed -En "${sed_extract_id_summary}" \
| sort -h \
| uniq \
| while IFS= read -r line; do
    read -r id summary <<< "${line}"
    summary=$(json_escape "${summary}")

    # json does not allow trailing commas
    if [[ "${first_object}" = true ]]; then
        first_object=false
    else
        printf ",\n" >> "${git_json}"
    fi

    printf "  { \"id\": %s, \"summary\": \"%s\" }" ${id} "${summary}" >> "${git_json}"
done
printf "\n]\n" >> "${git_json}"

#
# Download Bugzilla Triage List
#

# search for:
# + Product is NOT "Thunderbird,Calander,Chat Core,MailNews Core" (&f1=product&n1=1&o1=anyexact&v1=Thunderbird%2CCalendar%2CChat%20Core%2CMailNews%20Core). AND
# + Target Milestone contains "${firefox_version}" (115 Branch or Firefox 115) (&f2=target_milestone&o2=substring&v2=${firefox_version}).
# "&limit=0" shows all matching bugs.

query_tail="&f1=product&n1=1&o1=anyexact&v1=Thunderbird%2CCalendar%2CChat%20Core%2CMailNews%20Core&f2=target_milestone&o2=substring&v2=${firefox_version}&limit=0"

bugzilla_query="https://bugzilla.mozilla.org/buglist.cgi?${query_tail}"
bugzilla_json_query="https://bugzilla.mozilla.org/rest/bug?include_fields=id,component,summary${query_tail}"

wget "${bugzilla_json_query}" -O ${bugzilla_json}


#
# Create Union of these two sets of issues
#

# bugzilla array is actually on a root object: { bugs: [...] }
jq -s '[ (.[0].bugs)[], (.[1])[] ] | group_by(.id) | map(.[0])' "${bugzilla_json}" "${git_json}" > "${union_json}"

#
# Generate Triage CSV
#

echo "\"Review\",,\"Bugzilla Component\",\"Bugzilla Bug\""

jq '. | sort_by([.component, .id])[] | "\(.id)|\(.component)|\(.summary)"' ${union_json} \
| while IFS='|' read -r id component summary; do

    # bugzilla info
    id="${id:1}"
    component="${component:0}"
    summary="${summary:0:-1}"
    summary=$(jq_unescape "${summary}")
    # short summary for gitlab issue title
    [[ ${#summary} -gt 80 ]] && summary_short="${summary:0:77}..." || summary_short="${summary}"

    # filter out some issue types that we never care about
    skip_issue=false

    # skip `[wpt-sync] Sync PR`
    if [[ "${summary}" =~ ^\[wpt-sync\]\ Sync\ PR.*$ ]]; then
        skip_issue=true
    # skip `Crash in [@` and variants
    elif [[ "${summary}" =~ ^Crash[esin\ ]*\ \[\@.*$ ]]; then
        skip_issue=true
    # skip `Assertion failuire: `
    elif [[ "${summary}" =~ ^Assertion\ failure:\ .*$ ]]; then
        skip_issue=true
    # skip `Hit MOZ_CRASH`
    elif [[ "${summary}" =~ ^Hit\ MOZ_CRASH.*$ ]]; then
        skip_issue=true
    fi

    if [[ "${skip_issue}" = true ]]; then
        echoerr "Skipped Bugzilla ${id}: ${summary_short}"
    else
        csv_summary=$(csv_escape "${summary}")
        csv_component=$(csv_escape "${component}")

        # parent issue
        bugzilla_url="https://bugzilla.mozilla.org/show_bug.cgi?id=${id}"
        # review issue title
        new_issue_title=$(url_encode "Review Mozilla ${id}: ${summary_short}")
        # review issue description + labeling (14.0 stable, FF128-esr, Next)
        new_issue_description=$(url_encode "### Bugzilla: ${bugzilla_url}")%0A$(url_encode "/label ~\"14.0 stable\" ~FF128-esr ~Next")%0A$(url_encode "/relate tpo/applications/tor-browser-spec#${audit_issue}")%0A%0A$(url_encode "<!-- briefly describe why this issue needs further review -->")%0A
        # url which create's new issue with title and description pre-populated
        new_issue_url="https://gitlab.torproject.org/tpo/applications/tor-browser/-/issues/new?issue[title]=${new_issue_title}&issue[description]=${new_issue_description}"

        # this link will start the creation of a new gitlab issue to review
        create_issue=$(csv_escape "=HYPERLINK(\"${new_issue_url}\", \"New Issue\")")
        bugzilla_link=$(csv_escape "=HYPERLINK(\"${bugzilla_url}\", \"Bugzilla ${id}: ${csv_summary}\")")

        echo "FALSE,\"${create_issue}\",\"${csv_component}\",\"${bugzilla_link}\","
    fi
done

echo
echo "\"Triaged by:\""
for reviewer in $reviewers; do
    reviewer=$(csv_escape "${reviewer}")
    echo "\"FALSE\",\"${reviewer}\""
done
echo

bugzilla_query="=HYPERLINK(\"${bugzilla_query}\", \"Bugzilla query\")"
echo \"$(csv_escape "${bugzilla_query}")\"
