"""Spoken teacher script for the approved Q26 lesson, with real scene timing.

visualFrom/visualTo are canonical seconds in TeachingVisual.tsx (30 fps, pace 1),
not guessed speech duration. The voice timeline maps each clip's measured audio
duration onto that window. A zero-length window holds the board while speaking.
"""


def _latex(value):
    return "".join(value.split()).replace("\\\\", "\\").replace("$", "") if isinstance(value, str) else ""


def _require_q26(part):
    message = "当前教案不是已适配的第26题，需重新制作老师讲稿，不能套用此配音。"
    if not isinstance(part, dict) or part.get("partId") != "main":
        raise ValueError(message)
    scene = part.get("scene", {})
    if not isinstance(scene, dict):
        raise ValueError(message)
    params = scene.get("params", {})
    if not isinstance(params, dict) or scene.get("kind") != "triangle-count":
        raise ValueError(message)
    if type(params.get("lower")) is not int or type(params.get("upper")) is not int or (params["lower"], params["upper"]) != (22, 24):
        raise ValueError(message)
    steps = part.get("steps", [])
    expected = [
        ("p1-step1", "把三角形数写成连续自然数和", r"T_n=1+2+3+\cdots+n"),
        ("p1-step2", "展开第24个和第22个三角形数", r"T_{24}=1+2+\cdots+22+23+24,\quad T_{22}=1+2+\cdots+22"),
        ("p1-step3", "抵消公共部分并求差", r"T_{24}-T_{22}=23+24=47"),
        ("p1-step4", "用求和公式检验", r"T_{24}=\frac{24\times25}{2}=300,\quad T_{22}=\frac{22\times23}{2}=253,\quad 300-253=47"),
    ]
    if not isinstance(steps, list) or len(steps) != len(expected):
        raise ValueError(message)
    for step, (step_id, title, formula) in zip(steps, expected):
        if not isinstance(step, dict) or step.get("id") != step_id or step.get("title") != title or _latex(step.get("formulaLatex")) != _latex(formula):
            raise ValueError(message)
        if not all(isinstance(step.get(field), str) and step[field].strip() for field in ("explanation", "reason")):
            raise ValueError(message)
    for field in ("goal", "method", "verification", "summary"):
        if not isinstance(part.get(field), str) or not part[field].strip():
            raise ValueError(message)
    for field in ("known", "prerequisites"):
        if not isinstance(part.get(field), list) or not part[field] or not all(isinstance(item, str) and item.strip() for item in part[field]):
            raise ValueError(message)
    answer = part.get("answer", {})
    if not isinstance(answer, dict) or answer.get("kind") != "choice" or answer.get("value") != "B" or "47" not in str(answer.get("display", "")):
        raise ValueError(message)
    misconceptions = part.get("misconceptions", [])
    if not isinstance(misconceptions, list) or len(misconceptions) != 2 or not all(
        isinstance(item, dict) and all(isinstance(item.get(field), str) and item[field].strip() for field in ("mistake", "correction"))
        for item in misconceptions
    ):
        raise ValueError(message)


def build_q26_script(part):
    """Return seven teacher chapters for the current approved Q26 only.

    This hand-authored spoken adaptation leaves the AI lesson untouched. Strict
    semantic/step checks prevent its audio being applied to a different problem.
    """
    _require_q26(part)

    def clip(text, start, end):
        return {"text": text, "visualFrom": start, "visualTo": end}

    return [
        {"stageIndex": 0, "clips": [
            clip("今天我们用石子点阵来认识三角形数。题目提到古希腊的毕达哥拉斯学派：一些数量的石子能排成三角形。我们要比较第二十四个和第二十二个三角形数。先别急着算，弄清楚第几个和多少个点的区别。", 0, 0),
            clip("看第一行，一个点。这是第一个三角形数，总点数是一。", 0, .47),
            clip("看第二行，新添两个点。现在有两行，总点数是一加二，等于三。所以三是第二个三角形数。", .48, .95),
            clip("看第三行，再添三个点。现在有三行，总点数是一加二加三，等于六。第几个由行数决定，不是由总点数决定。", .96, 1.43),
            clip("看第四行，新添四个点。六加四等于十，所以十是第四个三角形数。", 1.44, 1.91),
            clip("看第五行，新添五个点。十加五等于十五，第五个三角形数有十五个点。", 1.92, 2.39),
            clip("看第六行，新添六个点。十五加六等于二十一，第六个三角形数有二十一点。", 2.4, 2.87),
            clip("现在我们看懂一、三、六、十、十五、二十一这个数列了。第几个就是有几行，各行点数加起来才是总点数。试卷图中只画了前四个，后面的省略号表示按同样规律继续，并不是后面没有石子。", 2.88, 2.88),
        ]},
        {"stageIndex": 1, "clips": [
            clip("先用小一点的点阵找方法。左边是第六个，共二十一点；右边是第四个，共十点。要算两个数的差，你能找出它们相同的部分吗？看，前四行完全一样。", 0, .79),
            clip("我们把相同的前四行标记抵消。为什么可以这样做？因为一份里面有的，另一份里面也有，相减后这部分的贡献是零。", .8, 1.6),
            clip("留下第五行和第六行，五加六等于十一。这个小例只帮我们找到方法，十一还不是原题的答案。回到原题也先找相同部分，再数新增的行，最后用另一种算法独立检验。", 1.6, 2.8),
        ]},
        {"stageIndex": 2, "clips": [
            clip("把刚才看到的规律写成数学语言。我们用板书里的字母恩代表序号。第恩个三角形数有恩行，第一行一个点，第二行两个点，一直排到第恩行的恩个点。", 0, .6),
            clip("所以总点数就是一加二加三，一直加到恩。板书用大写字母提，下标写字母恩，表示这个三角形数。这里的下标恩说明第几个，整个符号所表示的数才是全部石子的数量。", .6, 1.2),
            clip("这一步的理由来自每一行的点数规律。我们不是把一、三、六直接接着加，而是把同一个三角形里面的第一行、第二行、第三行，一直到最后一行的点数加起来。", 1.2, 1.2),
        ]},
        {"stageIndex": 3, "clips": [
            clip("现在回到原题，展开第二十四个和第二十二个三角形数。左边从一加到二十四，右边从一加到二十二。它们相同在哪里？", 0, .64),
            clip("两边都包含相同的前二十二行，共二百五十三个点。板书用省略块代表这部分，省略的是画法，不是点数。两份二百五十三都要保留，才能看清谁和谁抵消。", .65, 1.29),
            clip("看左边多出的第二十三行。这一行恰好有二十三个点，右边的第二十二个三角形没有这一行。", 1.3, 1.59),
            clip("再看第二十四行，这一行有二十四个点。所以左边等于右边的全部点，再加二十三，再加二十四。相隔两个序号，是多出两行，不是只多出两个点。", 1.6, 2.8),
        ]},
        {"stageIndex": 4, "clips": [
            clip("接下来做减法。我们要比较的是总点数，因此先把共同部分完整找出来：两边都是前二十二行的二百五十三个点。", 0, .29),
            clip("把这两份相同部分标记抵消。它们在减法中一正一负，合起来贡献零。不是这些点从原来的三角形中消失了，而是求差时不用再数这部分。", .3, 1.1),
            clip("现在只数剩下的两行。二十三加二十四等于四十七，差是四十七个点，对应选项B。只算二十三会少算一行，只算二十四也会少算一行，两行都必须算进去。", 1.1, 2.8),
        ]},
        {"stageIndex": 5, "clips": [
            clip("我们已经得到四十七，但好的解答还要检查。换用求和公式独立检验，序号仍用字母恩表示。从一加到恩，等于恩乘括号里的恩加一，再除以二。计算时先把括号里的恩加一，再乘恩，最后除以二。", 0, .6),
            clip("先算第二十四个。二十四乘二十五再除以二，等于三百。这是第二十四个三角形的全部点数，不只是新增两行。", .6, 1.2),
            clip("再算第二十二个。二十二乘二十三再除以二，等于二百五十三。这也核对了省略块代表的准确数量。", 1.2, 1.8),
            clip("三百减二百五十三等于四十七，和抵消法完全一致。两种方法得到相同结果，说明我们没有少加或多加一行，答案仍然是选项B。", 1.8, 2.8),
        ]},
        {"stageIndex": 6, "clips": [
            clip("最后回看整个思路：先观察每一行，再把第几个翻译成从一加到几，接着找共同部分，数新增的行，最后用公式复算。", 0, .6),
            clip("特别注意两种容易出错的想法。直接用二十四减二十二等于二，算出来的是序号差，不能当作总点数的差。只留下二十三或二十四，又会漏掉另一行。", .6, 1.2),
            clip("本题留下第二十三行和第二十四行，因此二十三加二十四等于四十七。四十七表示多出的石子点数，不是三角形的面积，也不是行数。", 1.2, 2.2),
            clip("以后遇到规律数列两项的差，可以先把每一项写成求和式或公式，再找相同部分。真正要记住的是这条思考路线，而不只是四十七这个答案。你有疑问时随时提问，我们会停在当前板书，讲明白后再继续。", 2.2, 2.8),
        ]},
    ]
