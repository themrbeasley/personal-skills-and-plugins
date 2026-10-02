import json
import os, sys


def load_reviews(path):
    f = open(path)
    data = json.load(f)
    f.close()
    return data


def average_rating(reviews):
    total = 0
    for r in reviews:
        total += r["rating"]
    return total / len(reviews)


def top_reviewers(reviews, n=3):
    counts = {}
    for r in reviews:
        if r["user"] in counts:
            counts[r["user"]] = counts[r["user"]] + 1
        else:
            counts[r["user"]] = 1
    result = []
    for user in sorted(counts, key=lambda u: counts[u], reverse=True):
        result.append(user)
    return result[:n]


def summary(path):
    reviews = load_reviews(path)
    avg = average_rating(reviews)
    tops = top_reviewers(reviews)
    return "Average: " + str(avg) + ", top reviewers: " + ", ".join(tops)


if __name__ == "__main__":
    print(summary(sys.argv[1]))
