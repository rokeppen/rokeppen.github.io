let wordPairs = new Map();

window.onload = function() {
    getWords()
};

function getWords() {
    fetch("/words.csv").then(r => r.text()).then(text => {
        let lines = text.trim().split("\n");
        shuffleArray(lines);
        lines.forEach(line => {
            const [key, value] = line.split(";");
            wordPairs.set(key.trim(), value.trim());
        });
    }).then(pickRandom)
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        let temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}

function getRandomKey(collection) {
    let keys = Array.from(collection.keys());
    const index = Math.floor(Math.random() * keys.length);
    return keys[index];
}

function pickRandom() {
    if (wordPairs.size === 0) {
        $("#word").html("Je hebt alles juist!");
        $("#answer").hide()
    } else {
        const key = getRandomKey(wordPairs)
        $("#word").html(key);
        $("#question").show();
        $("#answer").hide().html(wordPairs.get(key));
    }
    $("#correct").prop('disabled', true);
    $("#wrong").prop('disabled', true);
}

function showAnswer() {
    $("#answer").show();
    $("#question").hide();
    $("#correct").prop('disabled', false);
    $("#wrong").prop('disabled', false);
}

function pickNext(correctGuess) {
    if (correctGuess) {
        wordPairs.delete($("#word").html());
    }
    pickRandom();
}