$(document).ready(function () {
    getTodayQuestion()
});

function getTodayQuestion() {
    fetch("questions.json").then(r => r.json())
        .then(questions => {
            const dayParam = new URLSearchParams(window.location.search).get("day");
            const todayKey = dayParam || new Date().toLocaleDateString();
            const question = questions[todayKey];
            if (question) {
                loadQuestion(question)
            } else {
                location.href = "shame.html";
            }
        })
}

function loadQuestion(question) {
    $("#questionText").text(question.question);
    const container = $("#optionsContainer");
    container.empty();

    Object.entries(question.options).forEach(([key, value]) => {
        const btn = $(`
            <button class="option-btn" data-key="${key}">
                <span class="option-key">${key.toUpperCase()}</span>
                <span class="option-text">${value}</span>
            </button>
        `);

        btn.on("click", function () {
            if ($(this).data("key") === question.answer) {
                showAnswer(question.giftNumber);
            } else {
                $(this).addClass("wrong");
            }
        });

        container.append(btn);
    });
}

function showAnswer(giftNumber) {
    const card = $(".card");
    card.empty(); // remove all current content
    card.append($(`
        <div class="answer-message">
            Juist, je verdient cadeautje ${giftNumber}!
        </div>
    `));
}