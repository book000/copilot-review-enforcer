import * as core from "@actions/core";
import * as github from "@actions/github";

/**
 * Fetch review comments from a pull request.
 *
 * @param {Octokit} octokit Octokit instance
 * @param {string} owner Repository owner
 * @param {string} repo Repository name
 * @param {number} pullRequestNumber Pull request number
 * @returns {Promise<object>} GraphQL response data
 */
async function fetchReviewComments(octokit, owner, repo, pullRequestNumber) {
  const query = `
    query FetchReviewComments($owner: String!, $repo: String!, $pullRequestNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pullRequestNumber) {
          reviewThreads(last: 100) {
            nodes {
              isResolved
              comments(first: 1) {
                nodes {
                  author {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await octokit.graphql({
      query,
      owner,
      repo,
      pullRequestNumber,
    });

    return response;
  } catch (error) {
    console.error("Error fetching review comments:", error.message);
    process.exit(1);
  }
}

/**
 * Check unresolved comments by a specific author in a pull request.
 *
 * @param {Octokit} octokit Octokit instance
 * @param {string} owner Repository owner
 * @param {string} repo Repository name
 * @param {number} pullRequestNumber Pull request number
 * @param {string} targetLogin Target author login
 * @returns {Promise<void>}
 */
async function checkUnresolvedComments(
  octokit,
  owner,
  repo,
  pullRequestNumber,
  targetLogin
) {
  const data = await fetchReviewComments(
    octokit,
    owner,
    repo,
    pullRequestNumber
  );

  const reviewThreads = data.repository.pullRequest.reviewThreads.nodes;
  console.log("Review threads:", reviewThreads);

  // Filter unresolved comments by the target author
  const unresolvedComments = reviewThreads.filter(
    (thread) =>
      !thread.isResolved &&
      thread.comments.nodes.some(
        (comment) =>
          comment.author.login === targetLogin ||
          comment.author.login === targetLogin.replace("[bot]", "")
      )
  );

  if (unresolvedComments.length > 0) {
    console.error(
      `Found ${unresolvedComments.length} unresolved comments by ${targetLogin}.`
    );
    return false;
  } else {
    console.log(`All comments by ${targetLogin} are resolved.`);
    return true;
  }
}

/**
 * Check if a pull request is pending review by a specific author.
 *
 * @param {Octokit} octokit Octokit instance
 * @param {string} owner Repository owner
 * @param {string} repo Repository name
 * @param {number} pullRequestNumber Pull request number
 * @param {string} targetLogin Target author login
 * @returns {Promise<boolean>} Whether the pull request is pending review
 */
async function isPendingReview(
  octokit,
  owner,
  repo,
  pullRequestNumber,
  targetLogin
) {
  const reviews = await octokit.rest.pulls.listReviews({
    owner,
    repo,
    pull_number: pullRequestNumber,
  });
  console.log("listReviews:", reviews.data);

  const reviewed = reviews.data.some(
    (review) => review.user.login === targetLogin && review.state === "PENDING"
  );
  return reviewed;
}

async function main() {
  const inputToken = core.getInput("token");
  const inputOwner = core.getInput("owner");
  const inputRepo = core.getInput("repo");
  const inputPullRequestNumber = core.getInput("pull_request_number");
  const targetLogin = core.getInput("target_login");

  const eventName = github.context.eventName;
  const action = github.context.payload.action;

  const token = inputToken !== "" ? inputToken : process.env.GITHUB_TOKEN;
  const owner = inputOwner !== "" ? inputOwner : github.context.repo.owner;
  const repo = inputRepo !== "" ? inputRepo : github.context.repo.repo;
  const pullRequestNumber = parseInt(
    inputPullRequestNumber !== ""
      ? inputPullRequestNumber
      : github.context.issue.number,
    10
  );

  console.log("Inputs:", { owner, repo, pullRequestNumber, targetLogin });
  console.log("Event:", { eventName, action });

  const required = {
    owner,
    repo,
    pullRequestNumber,
    targetLogin,
  };
  const missing = Object.entries(required).filter(([_, value]) => !value);
  if (missing.length > 0) {
    console.error(
      `Missing required inputs: ${missing.map(([key]) => key).join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  const octokit = github.getOctokit(token);

  let exitCode = 0;
  if (
    await isPendingReview(octokit, owner, repo, pullRequestNumber, targetLogin)
  ) {
    console.log(`Pull request is pending review by ${targetLogin}.`);
    exitCode = 1;
  }

  console.log("Checking unresolved comments...");
  const result = await checkUnresolvedComments(
    octokit,
    owner,
    repo,
    pullRequestNumber,
    targetLogin
  );
  exitCode = result ? exitCode : 1;

  process.exitCode = exitCode;
}

(async () => {
  await main();
})();
