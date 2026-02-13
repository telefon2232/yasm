fn square(x: i32) -> i32 {
    x * x
}

fn sum_squares(n: i32) -> i32 {
    let mut total = 0;
    for i in 1..=n {
        total += square(i);
    }
    total
}

fn main() {
    let result = sum_squares(10);
    println!("Sum of squares 1..10 = {}", result);
}
